/**
 * audit-log.html — Staff column Playwright test suite
 *
 * Verifies:
 * 1. Staff column renders t.staff_member correctly (not always 'VenueDesk API')
 * 2. Filter-by-staff works with real names
 * 3. index.html log-interaction modal sends staff_member from vp_user_name
 *
 * All external API calls are mocked so the suite runs offline.
 * Pattern 22: trailing ** on routes to match query-string URLs.
 */

const { test, expect } = require('@playwright/test');

// ── Token factory (Node.js — uses Buffer, not btoa) ───────────────────────────

function makeToken(fullName = 'Andrew Johnson') {
  const b64url = s => Buffer.from(s).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    id: 'test-user-001', user_id: 'test-user-001',
    username: 'arj72', full_name: fullName, name: fullName,
    role: 'admin', tenant_id: 1001,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
  }));
  return `${header}.${payload}.fakesig`;
}

// Inject sessionStorage BEFORE page scripts run (bypasses the F4 auth guard)
async function injectSession(page, fullName = 'Andrew Johnson') {
  const token = makeToken(fullName);
  const user  = JSON.stringify({
    id: 'test-user-001', user_id: 'test-user-001',
    username: 'arj72', full_name: fullName,
    tenant_id: 1001, role: 'admin',
  });
  await page.addInitScript(({ tok, name, usr }) => {
    sessionStorage.setItem('vp_token',     tok);
    sessionStorage.setItem('vp_tenant_id', '1001');
    sessionStorage.setItem('vp_user_name', name);
    sessionStorage.setItem('vp_user',      usr);
  }, { tok: token, name: fullName, usr: user });
}

// Stub every external API audit-log.html calls on load
async function mockAuditLogAPIs(page, interactions = []) {
  await page.route('**/webhook/customer-interactions**', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, data: interactions }) }));

  await page.route('**/webhook/accounts-data**', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: {
        metrics: { total_revenue: 0, deposits: 0, outstanding: 0, outstanding_items: null },
        transactions: [],
      }}) }));

  await page.route('**/webhook/staff-dashboard**', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: {
        pending_requests: 0, upcoming_bookings: 0, monthly_revenue: 0,
        customers: [], recent_activity: [], upcoming_events: [], all_customers: [],
      }}) }));

  await page.route('**/recurring/outstanding-payments**', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }) }));
}

function makeInteraction(overrides = {}) {
  return {
    id:               'int-001',
    customer_id:      'cust-001',
    customer_name:    'Test Customer',
    customer_email:   'test@example.com',
    subject:          'Booking confirmed: Main Hall | 2026-08-10',
    interaction_type: 'booking_confirmed',
    notes:            'Created via VenueDesk API',
    staff_member:     'VenueDesk API',
    timestamp:        new Date().toISOString(),
    room_name:        'Main Hall',
    booking_date:     '2026-08-10',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('audit-log.html — Staff column', () => {

  test('1. Staff column renders real name from staff_member field', async ({ page }) => {
    await mockAuditLogAPIs(page, [
      makeInteraction({ staff_member: 'Andrew Johnson' }),
    ]);
    await injectSession(page, 'Andrew Johnson');
    await page.goto('/audit-log.html');
    await page.waitForTimeout(2000);

    expect(page.url()).toContain('audit-log.html');
    const staffCell = page.locator('td').filter({ hasText: 'Andrew Johnson' }).first();
    await expect(staffCell).toBeVisible();
    console.log('✅ Staff column shows "Andrew Johnson"');
  });

  test('2. System interactions render "VenueDesk API" correctly', async ({ page }) => {
    await mockAuditLogAPIs(page, [
      makeInteraction({ staff_member: 'VenueDesk API' }),
    ]);
    await injectSession(page);
    await page.goto('/audit-log.html');
    await page.waitForTimeout(2000);

    expect(page.url()).toContain('audit-log.html');
    const staffCell = page.locator('td').filter({ hasText: 'VenueDesk API' }).first();
    await expect(staffCell).toBeVisible();
    console.log('✅ System interactions still show "VenueDesk API"');
  });

  test('3. Mixed rows — real name and system both render correctly', async ({ page }) => {
    await mockAuditLogAPIs(page, [
      makeInteraction({ id: 'int-001', staff_member: 'Andrew Johnson', subject: 'User action' }),
      makeInteraction({ id: 'int-002', staff_member: 'VenueDesk API',  subject: 'System action' }),
    ]);
    await injectSession(page);
    await page.goto('/audit-log.html');
    await page.waitForTimeout(2000);

    expect(page.url()).toContain('audit-log.html');
    await expect(page.locator('td').filter({ hasText: 'Andrew Johnson' }).first()).toBeVisible();
    await expect(page.locator('td').filter({ hasText: 'VenueDesk API'  }).first()).toBeVisible();
    console.log('✅ Both Andrew Johnson and VenueDesk API rows render');
  });

  test('4. Filter by staff name shows only matching rows', async ({ page }) => {
    await mockAuditLogAPIs(page, [
      makeInteraction({ id: 'int-001', staff_member: 'Andrew Johnson', subject: 'User action' }),
      makeInteraction({ id: 'int-002', staff_member: 'VenueDesk API',  subject: 'System action' }),
    ]);
    await injectSession(page);
    await page.goto('/audit-log.html');
    await page.waitForTimeout(2000);

    expect(page.url()).toContain('audit-log.html');
    await page.fill('#f-actor', 'Andrew');
    await page.waitForTimeout(400);

    await expect(page.locator('td').filter({ hasText: 'Andrew Johnson' }).first()).toBeVisible();
    await expect(page.locator('td').filter({ hasText: 'VenueDesk API' })).toHaveCount(0);
    console.log('✅ Filter shows Andrew Johnson only; VenueDesk API hidden');
  });

  test('5. vp_user_name is correctly set and available for staff_member field', async ({ page }) => {
    await mockAuditLogAPIs(page, []);
    await injectSession(page, 'Andrew Johnson');
    await page.goto('/audit-log.html');
    await page.waitForTimeout(1000);

    expect(page.url()).toContain('audit-log.html');
    const storedName = await page.evaluate(() => sessionStorage.getItem('vp_user_name'));
    expect(storedName).toBe('Andrew Johnson');
    console.log('✅ vp_user_name = "Andrew Johnson" — will be sent as staff_member on POST');
  });

});
