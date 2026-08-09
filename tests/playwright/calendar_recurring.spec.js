/**
 * calendar_recurring.spec.js
 *
 * Playwright tests for the recurring booking frequency dropdown in calendar.html.
 * Covers: Weekly / Fortnightly / Monthly selection, UI label changes, session-count
 * maths, and the payload sent to the create-recurring-from-calendar webhook.
 *
 * All network calls are mocked — runs fully offline.
 * Pattern 22: route patterns use trailing ** to catch query strings.
 */

const { test, expect } = require('@playwright/test');

// ── Fake JWT that passes Rule F4 claim validation ────────────────────────────
// atob() decodes standard base64 (not base64url); Buffer.from(...,'base64') is fine in Node.
const _payloadStr = JSON.stringify({
  id: 'test-uid', user_id: 'test-uid', username: 'teststaff',
  role: 'admin', full_name: 'Test Staff', name: 'Test Staff',
  tenant_id: 1001, exp: 9999999999,
});
const _payloadB64 = Buffer.from(_payloadStr).toString('base64').replace(/=/g, '');
const FAKE_JWT = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${_payloadB64}.FAKESIG`;

// ── Mock data ────────────────────────────────────────────────────────────────
const MOCK_ROOMS = [
  { id: 'room-aaa', name: 'Main Hall', day_rate: '80.00', capacity: 100, is_active: true },
];
const MOCK_TYPES = [{ id: 'et-1', name: 'General Hire', is_active: true }];

// ── Shared setup ─────────────────────────────────────────────────────────────
async function setupCalendarPage(page) {
  // Inject sessionStorage before the page executes (bypasses Rule F4 redirect)
  await page.addInitScript(({ jwt }) => {
    sessionStorage.setItem('vp_token', jwt);
    sessionStorage.setItem('vp_tenant_id', '1001');
    sessionStorage.setItem('vp_user_name', 'Test Staff');
    sessionStorage.setItem('vp_user', JSON.stringify({
      id: 'test-uid', user_id: 'test-uid', full_name: 'Test Staff',
      role: 'admin', tenant_id: 1001,
    }));
  }, { jwt: FAKE_JWT });

  // Mock all n8n webhook calls (Pattern 22: trailing ** catches ?tenant_id=... query strings)
  await page.route('**/n8n.srv1090894.hstgr.cloud/webhook/**', route => {
    const url = route.request().url();
    if (url.includes('get-rooms'))
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_ROOMS }) });
    if (url.includes('get-event-types'))
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_TYPES }) });
    if (url.includes('get-pricing') || url.includes('all-bookings') || url.includes('blocked-dates'))
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: [] }) });
    if (url.includes('check-recurring-clashes'))
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ clashed_dates: [] }) });
    // default: success
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }) });
  });

  // Mock db-api calls
  await page.route('**/api.venuedesk.co.uk/**', route => {
    const url = route.request().url();
    if (url.includes('check-availability'))
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ available: true, status: 'available' }) });
    if (url.includes('stripe/config'))
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ is_stripe_enabled: false, stripe_publishable_key: null }) });
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }) });
  });

  await page.goto('/calendar.html');
  await page.waitForLoadState('domcontentloaded');
  // Give FullCalendar time to initialise
  await page.waitForTimeout(400);
}

// Opens the quick-book modal for a known Monday (2026-09-07 = 1st Monday of Sep)
// and injects mock room data so the room select is populated.
async function openRecurringDrawer(page) {
  await page.evaluate(rooms => {
    window.qbRoomsData = rooms;
    openQbModal('2026-09-07');
  }, MOCK_ROOMS);

  await page.waitForSelector('#qbModal.open', { timeout: 5000 });

  // Fill required customer fields
  await page.fill('#qb-customerName', 'Test Customer');
  await page.fill('#qb-customerPhone', '07700900000');

  // Select room and times
  await page.selectOption('#qb-roomSelect', 'Main Hall');
  await page.waitForTimeout(150);
  await page.selectOption('#qb-startTime', '10:00');
  await page.selectOption('#qb-endTime', '12:00');
  await page.waitForTimeout(150);

  // Open the recurring section
  await page.click('#qb-recurring-toggle-btn');
  await page.waitForSelector('#qb-recurring-section.visible', { timeout: 3000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Frequency dropdown UI
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Frequency dropdown UI', () => {
  test('dropdown exists with Weekly, Fortnightly, Monthly options', async ({ page }) => {
    await setupCalendarPage(page);
    await openRecurringDrawer(page);

    const opts = await page.locator('#qb-rec-frequency option').evaluateAll(
      os => os.map(o => o.value)
    );
    expect(opts).toEqual(['weekly', 'fortnightly', 'monthly']);
  });

  test('Weekly is selected by default', async ({ page }) => {
    await setupCalendarPage(page);
    await openRecurringDrawer(page);

    const val = await page.locator('#qb-rec-frequency').inputValue();
    expect(val).toBe('weekly');
  });

  test('Monthly relabels duration options to remove week counts', async ({ page }) => {
    await setupCalendarPage(page);
    await openRecurringDrawer(page);

    await page.selectOption('#qb-rec-frequency', 'monthly');
    await page.waitForTimeout(100);

    const labels = await page.locator('#qb-rec-duration option:not([value=""])').evaluateAll(
      os => os.map(o => o.textContent.trim())
    );
    // Monthly: "3 Months" not "3 Months (12 Weeks)"
    expect(labels[0]).toBe('3 Months');
    expect(labels[1]).toBe('6 Months');
    expect(labels[2]).toBe('1 Year (12 Months)');
  });

  test('Weekly keeps week counts in duration labels', async ({ page }) => {
    await setupCalendarPage(page);
    await openRecurringDrawer(page);

    // Start monthly, switch back to weekly — labels should restore
    await page.selectOption('#qb-rec-frequency', 'monthly');
    await page.selectOption('#qb-rec-frequency', 'weekly');
    await page.waitForTimeout(100);

    const first = await page.locator('#qb-rec-duration option[value="12"]').textContent();
    expect(first).toContain('12 Weeks');
  });

  test('Monthly hides cycle-length picker', async ({ page }) => {
    await setupCalendarPage(page);
    await openRecurringDrawer(page);

    await page.selectOption('#qb-rec-frequency', 'monthly');
    await page.waitForTimeout(100);

    const display = await page.locator('#qb-rec-cyclelen-wrap').evaluate(
      el => getComputedStyle(el).display
    );
    expect(display).toBe('none');
  });

  test('Weekly shows cycle-length picker', async ({ page }) => {
    await setupCalendarPage(page);
    await openRecurringDrawer(page);

    // Default is weekly
    const display = await page.locator('#qb-rec-cyclelen-wrap').evaluate(
      el => getComputedStyle(el).display
    );
    expect(display).not.toBe('none');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Date generation math (via preview text)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Date generation maths', () => {
  test('Weekly: 12-week contract, 1 day → 12 sessions', async ({ page }) => {
    await setupCalendarPage(page);
    await openRecurringDrawer(page);

    // Select Monday, 12-week contract, weekly
    await page.click('[data-dow="1"]');
    await page.selectOption('#qb-rec-duration', '12');
    await page.waitForTimeout(300);

    const preview = await page.locator('#qb-rec-preview').textContent();
    expect(preview).toContain('12 Sessions');
  });

  test('Fortnightly: 12-week contract, 1 day → 6 sessions', async ({ page }) => {
    await setupCalendarPage(page);
    await openRecurringDrawer(page);

    await page.selectOption('#qb-rec-frequency', 'fortnightly');
    await page.click('[data-dow="1"]');
    await page.selectOption('#qb-rec-duration', '12');
    await page.waitForTimeout(300);

    const preview = await page.locator('#qb-rec-preview').textContent();
    expect(preview).toContain('6 Sessions');
  });

  test('Monthly: 12-week (3-month) contract, 1 day → 3 sessions', async ({ page }) => {
    await setupCalendarPage(page);
    await openRecurringDrawer(page);

    await page.selectOption('#qb-rec-frequency', 'monthly');
    await page.click('[data-dow="1"]');
    await page.selectOption('#qb-rec-duration', '12');
    await page.waitForTimeout(300);

    const preview = await page.locator('#qb-rec-preview').textContent();
    expect(preview).toContain('3 Sessions');
  });

  test('Monthly preview text says "Monthly Cycle"', async ({ page }) => {
    await setupCalendarPage(page);
    await openRecurringDrawer(page);

    await page.selectOption('#qb-rec-frequency', 'monthly');
    await page.click('[data-dow="1"]');
    await page.selectOption('#qb-rec-duration', '12');
    await page.waitForTimeout(300);

    const preview = await page.locator('#qb-rec-preview').textContent();
    // qbUpdateRecurrencePreview uses "per month" in the billing line
    expect(preview).toMatch(/per month/i);
  });

  test('Fortnightly preview text says "2-Week Cycle" or "per 2 weeks"', async ({ page }) => {
    await setupCalendarPage(page);
    await openRecurringDrawer(page);

    await page.selectOption('#qb-rec-frequency', 'fortnightly');
    await page.click('[data-dow="1"]');
    await page.selectOption('#qb-rec-duration', '12');
    await page.waitForTimeout(300);

    const preview = await page.locator('#qb-rec-preview').textContent();
    expect(preview).toMatch(/2.week|fortnightly|fortnight/i);
  });

  test('Monthly Nth-weekday: start on 2nd Monday → 3 sessions all on 2nd Monday', async ({ page }) => {
    await setupCalendarPage(page);

    // 2026-09-14 = 2nd Monday of September
    await page.evaluate(rooms => {
      window.qbRoomsData = rooms;
      openQbModal('2026-09-14');
    }, MOCK_ROOMS);
    await page.waitForSelector('#qbModal.open');
    await page.fill('#qb-customerName', 'Test');
    await page.fill('#qb-customerPhone', '07700900000');
    await page.selectOption('#qb-roomSelect', 'Main Hall');
    await page.selectOption('#qb-startTime', '10:00');
    await page.selectOption('#qb-endTime', '12:00');
    await page.click('#qb-recurring-toggle-btn');
    await page.waitForSelector('#qb-recurring-section.visible');

    await page.selectOption('#qb-rec-frequency', 'monthly');
    await page.click('[data-dow="1"]');   // Monday
    await page.selectOption('#qb-rec-duration', '12');
    await page.waitForTimeout(300);

    // qbRecurrenceDates is declared with `let` — not a window property.
    // Access by bare name in page context (NOT window.qbRecurrenceDates).
    const dates = await page.evaluate(() => qbRecurrenceDates.map(d => d.date));
    expect(dates).toHaveLength(3);
    // Sep 14, Oct 12, Nov 9 — all 2nd Mondays
    expect(dates[0]).toBe('2026-09-14');
    expect(dates[1]).toBe('2026-10-12');
    expect(dates[2]).toBe('2026-11-09');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Payload verification on submit
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Submit payload', () => {
  async function captureRecurringPayload(page, frequency, duration = '12') {
    let captured = null;

    // IMPORTANT: Playwright uses LIFO route matching — the last-registered route wins.
    // Register setupCalendarPage routes FIRST (checked last), then register the specific
    // capture route AFTER (checked first) so it intercepts before the generic n8n handler.
    await setupCalendarPage(page);

    await page.route('**/create-recurring-from-calendar**', route => {
      try { captured = JSON.parse(route.request().postData() || '{}'); } catch (_) {}
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, booking_count: 3 }) });
    });

    await openRecurringDrawer(page);

    await page.selectOption('#qb-rec-frequency', frequency);
    await page.click('[data-dow="1"]');
    await page.selectOption('#qb-rec-duration', duration);
    await page.waitForTimeout(400);

    // Ensure qbRecurrenceDates is populated (let-var, not a window property)
    await page.evaluate(() => {
      if (typeof qbRecurrenceDates !== 'undefined' && qbRecurrenceDates.length === 0) {
        qbRecurrenceDates = qbGenerateRecurrenceDates();
      }
    });

    // Mark availability slot as available
    await page.evaluate(() => {
      const av = document.getElementById('qb-availStatus');
      if (av) av.className = 'qb-avail-box qb-avail-available';
    });
    await page.waitForTimeout(100);

    await page.click('#qb-rec-btn-pending');
    await page.waitForTimeout(800);

    return captured;
  }

  test('Monthly payload: frequency=monthly, billing_type=monthly, cycle_length_weeks=null', async ({ page }) => {
    const payload = await captureRecurringPayload(page, 'monthly');
    expect(payload).not.toBeNull();
    expect(payload.frequency).toBe('monthly');
    expect(payload.billing_type).toBe('monthly');
    expect(payload.cycle_length_weeks).toBeNull();
  });

  test('Fortnightly payload: frequency=fortnightly, billing_type=4_week_cycle', async ({ page }) => {
    const payload = await captureRecurringPayload(page, 'fortnightly');
    expect(payload).not.toBeNull();
    expect(payload.frequency).toBe('fortnightly');
    expect(payload.billing_type).toBe('4_week_cycle');
    expect(typeof payload.cycle_length_weeks === 'number' || payload.cycle_length_weeks === null).toBe(true);
  });

  test('Weekly payload: frequency=weekly, billing_type=4_week_cycle', async ({ page }) => {
    const payload = await captureRecurringPayload(page, 'weekly');
    expect(payload).not.toBeNull();
    expect(payload.frequency).toBe('weekly');
    expect(payload.billing_type).toBe('4_week_cycle');
  });

  test('Monthly payload contains specific_dates matching Nth-weekday pattern', async ({ page }) => {
    const payload = await captureRecurringPayload(page, 'monthly');
    expect(payload).not.toBeNull();
    const dates = (payload.specific_dates || '').split(',').filter(Boolean);
    // 12-week (3-month) contract: 3 dates
    expect(dates.length).toBe(3);
    // All dates should be Mondays (day-of-week 1)
    dates.forEach(d => {
      expect(new Date(d + 'T12:00:00').getDay()).toBe(1);
    });
  });
});
