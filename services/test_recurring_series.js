/**
 * test_recurring_series.js
 * VenueDesk — Recurring Series Architecture Test Suite
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PURPOSE:
 *   Verifies the Parent-Child debt model is correctly enforced:
 *   - A £400 series stores £400 debt on recurring_series.balance_due
 *   - Every child session has balance_due = 0 (trigger enforced)
 *   - Querying FIRST session → shows £400 (from parent)
 *   - Querying LAST  session → shows £400 (same parent)
 *   - Recording a payment of £100 → parent drops to £300, child stays 0
 *   - Recording remaining £300   → parent drops to £0
 *
 * REQUIREMENTS:
 *   - PostgreSQL database with the bookings schema already migrated
 *     (run 001_recurring_series_architecture.sql first)
 *   - A test tenant_id = 9999 with a test customer and test room
 *     (created and torn down by this script)
 *   - npm install pg
 *
 * RUN:
 *   DATABASE_URL="postgres://user:pass@host:5432/dbname" node test_recurring_series.js
 *
 * EXIT CODES:
 *   0 = all tests passed
 *   1 = one or more tests failed
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { Pool }                   = require('pg');
const { RecurringBookingService } = require('./recurringBookingService');
const { BalanceService }          = require('./balanceService');

// ─── Config ───────────────────────────────────────────────────────────────────

const TEST_TENANT_ID = 9999;  // Isolated test tenant — never collides with production (1001)
const SERIES_VALUE   = 400;   // £400 total contract value we're testing
const SESSION_COUNT  = 5;     // 5 sessions × £80 each = £400
const RATE_PER_SESS  = 80;    // £80 per session

// ─── Test Runner ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label, actual, expected) {
    if (condition) {
        console.log(`  ✅  ${label}`);
        passed++;
    } else {
        console.error(`  ❌  ${label}`);
        console.error(`      Expected: ${JSON.stringify(expected)}`);
        console.error(`      Actual:   ${JSON.stringify(actual)}`);
        failed++;
    }
}

// ─── Main Test Suite ─────────────────────────────────────────────────────────

async function runTests() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL?.includes('sslmode=require')
            ? { rejectUnauthorized: false }
            : false,
    });

    const svc     = new RecurringBookingService(pool);
    const balance  = new BalanceService(pool);

    let customerId, roomId, seriesId;
    let firstSessionId, lastSessionId;

    // ── SETUP ─────────────────────────────────────────────────────────────
    console.log('\n━━━ SETUP ─────────────────────────────────────────────────\n');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Create isolated test customer under TEST_TENANT_ID
        const custRes = await client.query(
            `INSERT INTO bookings.customers
                (tenant_id, full_name, email, phone, status, created_at, updated_at)
             VALUES ($1, 'Test Customer (auto)', 'test-recurring@example.com', '07000000001', 'booked', NOW(), NOW())
             RETURNING id::text`,
            [TEST_TENANT_ID]
        );
        customerId = custRes.rows[0].id;
        console.log(`  Created test customer: ${customerId}`);

        // Create isolated test room under TEST_TENANT_ID
        const roomRes = await client.query(
            `INSERT INTO bookings.rooms
                (tenant_id, name, day_rate, is_active)
             VALUES ($1, 'Test Room (auto)', 200, true)
             RETURNING id::text`,
            [TEST_TENANT_ID]
        );
        roomId = roomRes.rows[0].id;
        console.log(`  Created test room:     ${roomId}`);

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }

    // ── TEST BLOCK 1: Series Creation ─────────────────────────────────────
    console.log('\n━━━ BLOCK 1: Series Creation ───────────────────────────────\n');

    const createResult = await svc.createSeries({
        tenant_id:        TEST_TENANT_ID,
        customer_id:      customerId,
        room_id:          roomId,
        rate_per_session: RATE_PER_SESS,  // £80
        sessions:         SESSION_COUNT,  // 5 sessions
        frequency:        'weekly',
        start_date:       '2025-07-07',   // Monday
        start_time:       '09:00',
        end_time:         '11:00',
        series_name:      'Test Series £400',
        performed_by:     'Test Runner',
    });

    assert(createResult.status === 'success',
        'createSeries returns status: success',
        createResult.status, 'success');

    assert(createResult.total_price === SERIES_VALUE,
        `createSeries total_price = £${SERIES_VALUE}`,
        createResult.total_price, SERIES_VALUE);

    assert(createResult.balance_due === SERIES_VALUE,
        `createSeries balance_due = £${SERIES_VALUE} (debt on parent)`,
        createResult.balance_due, SERIES_VALUE);

    assert(createResult.sessions_created === SESSION_COUNT,
        `createSeries sessions_created = ${SESSION_COUNT}`,
        createResult.sessions_created, SESSION_COUNT);

    seriesId = createResult.series_id;
    console.log(`\n  Series ID:      ${seriesId}`);
    console.log(`  First session:  ${createResult.first_session}`);
    console.log(`  Last session:   ${createResult.last_session}`);

    // ── TEST BLOCK 2: Parent Series Has Correct Balance ───────────────────
    console.log('\n━━━ BLOCK 2: Parent Series Balance ─────────────────────────\n');

    const client2 = await pool.connect();
    try {
        const parentRes = await client2.query(
            `SELECT balance_due, agreed_price, total_sessions, active
             FROM   bookings.recurring_series
             WHERE  id        = $1::uuid
               AND  tenant_id = $2::int`,
            [seriesId, TEST_TENANT_ID]
        );

        assert(parentRes.rowCount === 1,
            'Parent row exists in recurring_series',
            parentRes.rowCount, 1);

        const parent = parentRes.rows[0];

        assert(parseFloat(parent.balance_due) === SERIES_VALUE,
            `recurring_series.balance_due = £${SERIES_VALUE}`,
            parseFloat(parent.balance_due), SERIES_VALUE);

        assert(parseFloat(parent.agreed_price) === SERIES_VALUE,
            `recurring_series.agreed_price = £${SERIES_VALUE}`,
            parseFloat(parent.agreed_price), SERIES_VALUE);

        assert(parseInt(parent.total_sessions) === SESSION_COUNT,
            `recurring_series.total_sessions = ${SESSION_COUNT}`,
            parseInt(parent.total_sessions), SESSION_COUNT);

        assert(parent.active === true,
            'recurring_series.active = true',
            parent.active, true);

    } finally {
        client2.release();
    }

    // ── TEST BLOCK 3: All Children Have balance_due = 0 (Trigger Check) ──
    console.log('\n━━━ BLOCK 3: Child Sessions balance_due = 0 (Trigger) ──────\n');

    const client3 = await pool.connect();
    try {
        const childrenRes = await client3.query(
            `SELECT id::text, date_from::text, balance_due, recurring_series_id::text
             FROM   bookings.confirmed_bookings
             WHERE  recurring_series_id = $1::uuid
               AND  tenant_id           = $2::int
             ORDER  BY date_from ASC`,
            [seriesId, TEST_TENANT_ID]
        );

        assert(childrenRes.rowCount === SESSION_COUNT,
            `${SESSION_COUNT} child sessions created`,
            childrenRes.rowCount, SESSION_COUNT);

        const nonZero = childrenRes.rows.filter(r => parseFloat(r.balance_due) !== 0);
        assert(nonZero.length === 0,
            'ALL child sessions have balance_due = 0 (trigger enforced)',
            nonZero.length, 0);

        if (nonZero.length > 0) {
            console.error('    Sessions with non-zero balance:', nonZero);
        }

        firstSessionId = childrenRes.rows[0]?.id;
        lastSessionId  = childrenRes.rows[childrenRes.rows.length - 1]?.id;

        console.log(`  First session ID: ${firstSessionId} (${childrenRes.rows[0]?.date_from})`);
        console.log(`  Last  session ID: ${lastSessionId}  (${childrenRes.rows[childrenRes.rows.length-1]?.date_from})`);

    } finally {
        client3.release();
    }

    // ── TEST BLOCK 4: Balance from First Session = £400 ───────────────────
    console.log('\n━━━ BLOCK 4: Balance on First Session = £400 ───────────────\n');

    const firstBalance = await balance.getBalance(firstSessionId, TEST_TENANT_ID);

    assert(firstBalance.balance_due === SERIES_VALUE,
        `First session effective_balance_due = £${SERIES_VALUE} (pulled from parent)`,
        firstBalance.balance_due, SERIES_VALUE);

    assert(firstBalance.balance_source === 'recurring_series',
        'First session balance_source = "recurring_series"',
        firstBalance.balance_source, 'recurring_series');

    assert(firstBalance.series_id === seriesId,
        'First session series_id matches parent',
        firstBalance.series_id, seriesId);

    // ── TEST BLOCK 5: Balance from Last Session = £400 (same parent) ─────
    console.log('\n━━━ BLOCK 5: Balance on Last Session = £400 (same parent) ──\n');

    const lastBalance = await balance.getBalance(lastSessionId, TEST_TENANT_ID);

    assert(lastBalance.balance_due === SERIES_VALUE,
        `Last session effective_balance_due = £${SERIES_VALUE} (same parent)`,
        lastBalance.balance_due, SERIES_VALUE);

    assert(lastBalance.balance_source === 'recurring_series',
        'Last session balance_source = "recurring_series"',
        lastBalance.balance_source, 'recurring_series');

    assert(lastBalance.series_id === firstBalance.series_id,
        'First and last session point to the SAME parent series',
        lastBalance.series_id, firstBalance.series_id);

    // ── TEST BLOCK 6: v_booking_balance view agrees ────────────────────────
    console.log('\n━━━ BLOCK 6: v_booking_balance View ────────────────────────\n');

    const client6 = await pool.connect();
    try {
        const viewRes = await client6.query(
            `SELECT booking_id::text, effective_balance_due, balance_source
             FROM   bookings.v_booking_balance
             WHERE  booking_id = $1::uuid
               AND  tenant_id  = $2::int`,
            [firstSessionId, TEST_TENANT_ID]
        );

        assert(viewRes.rowCount === 1, 'v_booking_balance returns a row', viewRes.rowCount, 1);

        if (viewRes.rowCount === 1) {
            const viewRow = viewRes.rows[0];
            assert(parseFloat(viewRow.effective_balance_due) === SERIES_VALUE,
                `v_booking_balance.effective_balance_due = £${SERIES_VALUE}`,
                parseFloat(viewRow.effective_balance_due), SERIES_VALUE);

            assert(viewRow.balance_source === 'recurring_series',
                'v_booking_balance.balance_source = "recurring_series"',
                viewRow.balance_source, 'recurring_series');
        }
    } finally {
        client6.release();
    }

    // ── TEST BLOCK 7: Record Payment of £100 ─────────────────────────────
    console.log('\n━━━ BLOCK 7: Payment of £100 → Series balance drops to £300 \n');

    const payResult1 = await balance.recordPayment({
        booking_id:     firstSessionId,  // pay via the first child session
        amount:         100,
        payment_method: 'cash',
        tenant_id:      TEST_TENANT_ID,
        performed_by:   'Test Runner',
    });

    assert(payResult1.status === 'success',
        'Payment of £100 succeeds',
        payResult1.status, 'success');

    assert(payResult1.payment_type === 'recurring_series',
        'Payment correctly routed to recurring_series (not booking)',
        payResult1.payment_type, 'recurring_series');

    assert(payResult1.old_balance === SERIES_VALUE,
        `old_balance = £${SERIES_VALUE}`,
        payResult1.old_balance, SERIES_VALUE);

    assert(payResult1.new_balance === SERIES_VALUE - 100,
        `new_balance = £${SERIES_VALUE - 100}`,
        payResult1.new_balance, SERIES_VALUE - 100);

    // Verify the DB was actually updated
    const afterPay1 = await balance.getBalance(firstSessionId, TEST_TENANT_ID);
    assert(afterPay1.balance_due === SERIES_VALUE - 100,
        `After £100 payment: getBalance = £${SERIES_VALUE - 100}`,
        afterPay1.balance_due, SERIES_VALUE - 100);

    // Child session row must STILL be balance_due = 0
    const client7 = await pool.connect();
    try {
        const childCheck = await client7.query(
            `SELECT balance_due FROM bookings.confirmed_bookings WHERE id = $1::uuid`,
            [firstSessionId]
        );
        assert(parseFloat(childCheck.rows[0]?.balance_due) === 0,
            'Child session balance_due STILL = 0 after payment (debt on parent only)',
            parseFloat(childCheck.rows[0]?.balance_due), 0);
    } finally {
        client7.release();
    }

    // ── TEST BLOCK 8: Last Session Also Shows £300 (same parent) ─────────
    console.log('\n━━━ BLOCK 8: Last Session Now Shows £300 (same parent) ─────\n');

    const lastAfterPay = await balance.getBalance(lastSessionId, TEST_TENANT_ID);
    assert(lastAfterPay.balance_due === SERIES_VALUE - 100,
        `Last session balance_due = £${SERIES_VALUE - 100} (same parent, same update)`,
        lastAfterPay.balance_due, SERIES_VALUE - 100);

    // ── TEST BLOCK 9: Pay off remaining £300 → series balance = £0 ───────
    console.log('\n━━━ BLOCK 9: Pay Remaining £300 → Series Balance = £0 ──────\n');

    const payResult2 = await balance.recordPayment({
        booking_id:     lastSessionId,  // can pay via any child session
        amount:         300,
        payment_method: 'bank_transfer',
        tenant_id:      TEST_TENANT_ID,
        performed_by:   'Test Runner',
    });

    assert(payResult2.new_balance === 0,
        'After final payment: series balance_due = £0',
        payResult2.new_balance, 0);

    const finalBalance = await balance.getSeriesBalance(seriesId, TEST_TENANT_ID);
    assert(finalBalance.balance_due === 0,
        'getSeriesBalance confirms balance_due = £0',
        finalBalance.balance_due, 0);

    // ── TEST BLOCK 10: Trigger blocks non-zero child balance on UPDATE ────
    console.log('\n━━━ BLOCK 10: Trigger Prevents Non-Zero Child balance_due ──\n');

    const client10 = await pool.connect();
    try {
        // Try to manually set balance_due > 0 on a child session
        // The trigger must auto-correct this to 0
        await client10.query(
            `UPDATE bookings.confirmed_bookings
             SET    balance_due = 999.00
             WHERE  id          = $1::uuid`,
            [firstSessionId]
        );

        const postUpdate = await client10.query(
            `SELECT balance_due FROM bookings.confirmed_bookings WHERE id = $1::uuid`,
            [firstSessionId]
        );

        assert(parseFloat(postUpdate.rows[0]?.balance_due) === 0,
            'Trigger auto-corrects balance_due to 0 on child UPDATE (invariant enforced)',
            parseFloat(postUpdate.rows[0]?.balance_due), 0);

    } finally {
        client10.release();
    }

    // ── TEST BLOCK 11: Tenant Isolation ──────────────────────────────────
    console.log('\n━━━ BLOCK 11: Tenant Isolation ─────────────────────────────\n');

    try {
        // Attempt to create a series claiming a customer from a different tenant
        await svc.createSeries({
            tenant_id:        8888,        // different tenant
            customer_id:      customerId,  // customer belongs to TEST_TENANT_ID (9999)
            room_id:          roomId,
            rate_per_session: 50,
            sessions:         3,
            frequency:        'weekly',
            start_date:       '2025-08-01',
            start_time:       '10:00',
            end_time:         '11:00',
        });

        // Should NOT reach here
        assert(false,
            'Cross-tenant series creation correctly rejected',
            'no error thrown', 'TenantIsolationError');

    } catch (e) {
        assert(e.name === 'TenantIsolationError',
            'Cross-tenant creation throws TenantIsolationError',
            e.name, 'TenantIsolationError');
    }

    // ── TEARDOWN ─────────────────────────────────────────────────────────
    console.log('\n━━━ TEARDOWN ───────────────────────────────────────────────\n');

    const clientTD = await pool.connect();
    try {
        await clientTD.query('BEGIN');

        // Delete child sessions first (FK constraint)
        await clientTD.query(
            `DELETE FROM bookings.confirmed_bookings WHERE recurring_series_id = $1::uuid`,
            [seriesId]
        );

        // Delete parent series
        await clientTD.query(
            `DELETE FROM bookings.recurring_series WHERE id = $1::uuid`,
            [seriesId]
        );

        // Clean up payments
        await clientTD.query(
            `DELETE FROM bookings.payments WHERE tenant_id = $1::int`,
            [TEST_TENANT_ID]
        );

        // Clean up interactions
        await clientTD.query(
            `DELETE FROM bookings.customer_interactions WHERE tenant_id = $1::int`,
            [TEST_TENANT_ID]
        );

        // Delete test customer (cascades)
        await clientTD.query(
            `DELETE FROM bookings.customers WHERE id = $1::uuid`,
            [customerId]
        );

        // Delete test room
        await clientTD.query(
            `DELETE FROM bookings.rooms WHERE id = $1::uuid`,
            [roomId]
        );

        await clientTD.query('COMMIT');
        console.log('  Test data cleaned up ✓');

    } catch (e) {
        await clientTD.query('ROLLBACK');
        console.error('  Teardown failed (data may remain in DB):', e.message);
    } finally {
        clientTD.release();
    }

    // ── SUMMARY ──────────────────────────────────────────────────────────
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`  RESULTS: ${passed} passed · ${failed} failed\n`);

    if (failed > 0) {
        console.error(`  ❌  ${failed} test(s) FAILED — check output above.\n`);
    } else {
        console.log(`  ✅  All tests passed. Architecture is correct.\n`);
    }

    await pool.end();
    process.exit(failed > 0 ? 1 : 0);
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

runTests().catch(err => {
    console.error('\n  FATAL:', err.message);
    console.error(err.stack);
    process.exit(1);
});
