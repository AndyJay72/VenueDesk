/**
 * admin-config.html — Auto-Cancel Unpaid Bookings slider
 *
 * Tests the Cancellation Policy tab's Auto-Cancel card end-to-end:
 *   1.  Slider and card are present
 *   2.  Default value is 7, label reads "7 days"
 *   3.  Slider range is 1–30
 *   4a. Label updates live to "14 days" when moved
 *   4b. Label shows singular "1 day" at minimum
 *   5.  Slider populates from API value (14) on tab open
 *   6.  Save sends auto_cancel_unpaid_days with correct value
 *   7.  Save sends all four keys in one Promise.all round-trip
 *   8.  Failed save shows error state and re-enables button
 *   9.  Card copy mentions 48-hour warning
 *   10. Info box mentions 08:00 run time
 *
 * All network calls are intercepted — no live API needed.
 * addInitScript is registered BEFORE page.goto() so the F4 auth guard
 * sees a valid session and does not redirect to login.html.
 */

const { test, expect } = require('@playwright/test');

const PAGE_PATH = '/admin-config.html';

// ── Token factory (Node.js Buffer — same as audit_log_staff_e2e) ─────────────
function makeToken(opts = {}) {
  const b64url = s => Buffer.from(s).toString('base64url');
  const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    id:        'qa-admin-001', user_id: 'qa-admin-001',
    username:  'qa_admin',    full_name: 'QA Tester',
    name:      'QA Tester',   role: 'admin',
    tenant_id: 1001,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
    ...opts,
  }));
  return `${header}.${payload}.fakesig`;
}

// ── Mock settings payloads ────────────────────────────────────────────────────
const SETTINGS_DEFAULT = {
  success: true,
  data: [
    { key: 'cancel_full_refund_days',    value: '14' },
    { key: 'cancel_partial_refund_days', value: '7'  },
    { key: 'cancel_partial_refund_pct',  value: '50' },
    { key: 'auto_cancel_unpaid_days',    value: '7'  },
  ],
};

const SETTINGS_CUSTOM_14 = {
  success: true,
  data: [
    { key: 'cancel_full_refund_days',    value: '14' },
    { key: 'cancel_partial_refund_days', value: '7'  },
    { key: 'cancel_partial_refund_pct',  value: '50' },
    { key: 'auto_cancel_unpaid_days',    value: '14' },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Must be called BEFORE page.goto() — uses addInitScript so sessionStorage
// is populated before the page's inline scripts run the F4 auth guard.
async function setupAuth(page) {
  const token = makeToken();
  const user  = JSON.stringify({
    id: 'qa-admin-001', user_id: 'qa-admin-001',
    username: 'qa_admin', full_name: 'QA Tester',
    tenant_id: 1001, role: 'admin',
  });
  await page.addInitScript(({ tok, usr }) => {
    sessionStorage.setItem('vp_token',     tok);
    sessionStorage.setItem('vp_tenant_id', '1001');
    sessionStorage.setItem('vp_user_name', 'QA Tester');
    sessionStorage.setItem('vp_user',      usr);
  }, { tok: token, usr: user });
}

// Register all network mocks. settingsData controls what get-settings returns.
// Must be called BEFORE page.goto().
//
// Pattern 22 — LIFO route matching: register catch-alls FIRST so they are
// checked LAST. Specific routes registered AFTER win over the catch-all.
async function mockAPIs(page, settingsData = SETTINGS_DEFAULT) {
  // Catch-alls — registered first = checked last (LIFO)
  await page.route('**/api.venuedesk.co.uk/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
                    body: JSON.stringify({ success: true, data: [] }) }));

  await page.route('**/n8n.srv1090894.hstgr.cloud/webhook/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
                    body: JSON.stringify({ success: true, data: [] }) }));

  // Specific routes — registered last = checked first (LIFO wins)
  await page.route('**/n8n.srv1090894.hstgr.cloud/webhook/update-setting**', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
                    body: JSON.stringify({ success: true }) }));

  await page.route('**/n8n.srv1090894.hstgr.cloud/webhook/get-settings**', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
                    body: JSON.stringify(settingsData) }));
}

// Navigate to the Cancellation Policy tab and wait for the slider to be visible.
async function openCancellationTab(page) {
  await page.click('button[onclick="switchTab(\'cancellation\')"]');
  await page.waitForSelector('#autoCancelDaysSlider', { state: 'visible', timeout: 5000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────
test.describe('Auto-Cancel slider — Cancellation Policy tab', () => {

  test('1. Auto-Cancel card and slider are present', async ({ page }) => {
    await mockAPIs(page);
    await setupAuth(page);
    await page.goto(PAGE_PATH);
    await openCancellationTab(page);

    await expect(page.locator('#autoCancelDaysSlider')).toBeVisible();
    await expect(page.locator('#autoCancelDaysLabel')).toBeVisible();
    await expect(page.locator('#autoCancelDaysVal')).toBeVisible();

    const heading = page.locator('#tab-cancellation').getByText('Auto-Cancel Unpaid Bookings');
    await expect(heading).toBeVisible();
  });

  test('2. Default value is 7 and label reads "7 days"', async ({ page }) => {
    await mockAPIs(page);
    await setupAuth(page);
    await page.goto(PAGE_PATH);
    await openCancellationTab(page);
    await page.waitForTimeout(300);   // allow loadSettings().then(loadCancellationPolicy) to settle

    const sliderVal  = await page.inputValue('#autoCancelDaysSlider');
    const labelText  = await page.textContent('#autoCancelDaysLabel');

    expect(parseInt(sliderVal, 10)).toBe(7);
    expect(labelText.trim()).toBe('7 days');
  });

  test('3. Slider range is min=1 max=30', async ({ page }) => {
    await mockAPIs(page);
    await setupAuth(page);
    await page.goto(PAGE_PATH);
    await openCancellationTab(page);

    expect(parseInt(await page.getAttribute('#autoCancelDaysSlider', 'min'), 10)).toBe(1);
    expect(parseInt(await page.getAttribute('#autoCancelDaysSlider', 'max'), 10)).toBe(30);
  });

  test('4a. Live label update — slider to 14 shows "14 days"', async ({ page }) => {
    await mockAPIs(page);
    await setupAuth(page);
    await page.goto(PAGE_PATH);
    await openCancellationTab(page);
    // Wait for loadSettings().then(loadCancellationPolicy) to finish resetting the slider
    // before we overwrite it — otherwise loadCancellationPolicy resets back to 7.
    await page.waitForTimeout(400);

    await page.evaluate(() => {
      const el = document.getElementById('autoCancelDaysSlider');
      el.value = '14';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect((await page.textContent('#autoCancelDaysLabel')).trim()).toBe('14 days');
  });

  test('4b. Live label update — slider to 1 shows singular "1 day"', async ({ page }) => {
    await mockAPIs(page);
    await setupAuth(page);
    await page.goto(PAGE_PATH);
    await openCancellationTab(page);

    await page.evaluate(() => {
      const el = document.getElementById('autoCancelDaysSlider');
      el.value = '1';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect((await page.textContent('#autoCancelDaysLabel')).trim()).toBe('1 day');
  });

  test('5. Slider loads value 14 from API on tab open', async ({ page }) => {
    await mockAPIs(page, SETTINGS_CUSTOM_14);   // auto_cancel_unpaid_days = 14
    await setupAuth(page);
    await page.goto(PAGE_PATH);
    await openCancellationTab(page);
    await page.waitForTimeout(400);   // allow mocked fetch to resolve

    const sliderVal  = await page.inputValue('#autoCancelDaysSlider');
    const displayVal = await page.textContent('#autoCancelDaysVal');

    expect(parseInt(sliderVal,  10)).toBe(14);
    expect(parseInt(displayVal, 10)).toBe(14);
  });

  test('6. Save POSTs auto_cancel_unpaid_days = 10 to update-setting', async ({ page }) => {
    const sentBodies = [];

    // LIFO: register catch-alls first via mockAPIs, then specific capture AFTER so it wins
    await mockAPIs(page);
    await page.route('**/n8n.srv1090894.hstgr.cloud/webhook/update-setting**', route => {
      let body = null;
      try { body = route.request().postDataJSON(); } catch(e) {}
      if (body) sentBodies.push(body);
      return route.fulfill({ status: 200, contentType: 'application/json',
                             body: JSON.stringify({ success: true }) });
    });
    await setupAuth(page);
    await page.goto(PAGE_PATH);
    await openCancellationTab(page);
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      const el = document.getElementById('autoCancelDaysSlider');
      el.value = '10';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click('#saveCancelPolicyBtn');
    await page.waitForTimeout(700);

    const autoSave = sentBodies.find(b => b.key === 'auto_cancel_unpaid_days');
    expect(autoSave).toBeTruthy();
    expect(parseInt(autoSave.value, 10)).toBe(10);
  });

  test('7. Save sends all four keys in one Promise.all batch', async ({ page }) => {
    const sentKeys = [];

    // LIFO: register catch-alls first, then specific capture AFTER
    await mockAPIs(page);
    await page.route('**/n8n.srv1090894.hstgr.cloud/webhook/update-setting**', route => {
      let body = null;
      try { body = route.request().postDataJSON(); } catch(e) {}
      if (body?.key) sentKeys.push(body.key);
      return route.fulfill({ status: 200, contentType: 'application/json',
                             body: JSON.stringify({ success: true }) });
    });
    await setupAuth(page);
    await page.goto(PAGE_PATH);
    await openCancellationTab(page);
    await page.waitForTimeout(300);

    await page.click('#saveCancelPolicyBtn');
    await page.waitForTimeout(700);

    for (const key of ['cancel_full_refund_days', 'cancel_partial_refund_days',
                       'cancel_partial_refund_pct', 'auto_cancel_unpaid_days']) {
      expect(sentKeys).toContain(key);
    }
    expect(sentKeys.length).toBeGreaterThanOrEqual(4);
  });

  test('8. Failed save re-enables the button and shows failure status', async ({ page }) => {
    // LIFO: catch-alls first, then override update-setting with a 500 response
    await mockAPIs(page);
    await page.route('**/n8n.srv1090894.hstgr.cloud/webhook/update-setting**', route =>
      route.fulfill({ status: 500, contentType: 'application/json',
                      body: JSON.stringify({ error: 'DB error' }) }));
    await setupAuth(page);
    await page.goto(PAGE_PATH);
    await openCancellationTab(page);
    await page.waitForTimeout(300);

    await page.click('#saveCancelPolicyBtn');
    await page.waitForTimeout(800);

    await expect(page.locator('#saveCancelPolicyBtn')).not.toBeDisabled();
    const statusText = (await page.textContent('#cancelPolicyStatus')).trim();
    expect(statusText.length).toBeGreaterThan(0);
  });

  test('9. Card copy mentions 48-hour warning', async ({ page }) => {
    await mockAPIs(page);
    await setupAuth(page);
    await page.goto(PAGE_PATH);
    await openCancellationTab(page);

    const cardText = await page.locator('#tab-cancellation').innerText();
    expect(cardText).toContain('48 hours');
    expect(cardText).toContain('automatically cancelled');
  });

  test('10. Info box mentions daily 08:00 run time', async ({ page }) => {
    await mockAPIs(page);
    await setupAuth(page);
    await page.goto(PAGE_PATH);
    await openCancellationTab(page);

    const cardText = await page.locator('#tab-cancellation').innerText();
    expect(cardText).toContain('08:00');
  });

});
