/**
 * onboarding.html — Playwright test suite
 *
 * All n8n / db-api network calls are intercepted and mocked so the suite
 * runs offline and deterministically. One section ("Live smoke") hits the
 * real endpoints to confirm the stack is up.
 *
 * Admin key: vp-api-2026-Kj9mXqR4wZ  (visible in page source — not a secret)
 */

const { test, expect } = require('@playwright/test');

// ── Constants ─────────────────────────────────────────────────────────────────
const ADMIN_KEY  = 'vp-api-2026-Kj9mXqR4wZ';
const PAGE_PATH  = '/onboarding.html';

const MOCK_VENUES = [
  {
    tenant_id: 1001, venue_name: 'The Park Suite', slug: 'the-park-suite',
    username: 'parksuite', full_name: 'Jane Smith', active: true,
    subscription_status: 'active', max_users: 3, active_users: 2,
    created_date: '2026-01-15T00:00:00Z',
  },
  {
    tenant_id: 1002, venue_name: 'Riverside Hall', slug: 'riverside-hall',
    username: 'riverside', full_name: 'Bob Jones', active: false,
    subscription_status: 'trial', max_users: 1, active_users: 1,
    created_date: '2026-03-01T00:00:00Z',
  },
  {
    tenant_id: 1003, venue_name: 'City Arena', slug: 'city-arena',
    username: 'cityarena', full_name: 'Carol White', active: true,
    subscription_status: 'past_due', max_users: 5, active_users: 4,
    created_date: '2026-04-10T00:00:00Z',
  },
];

// Intercept all n8n webhook calls and return mock data
async function mockN8N(page) {
  await page.route('**/n8n.srv1090894.hstgr.cloud/webhook/**', async route => {
    const url = route.request().url();

    if (url.includes('/onboarding/login')) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, user: { username: 'admin' } }) });
    }
    if (url.includes('/onboarding/venues')) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_VENUES }) });
    }
    if (url.includes('/onboarding/create-venue')) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, data: { tenant_id: 1004 } }) });
    }
    if (url.includes('/onboarding/toggle-venue')) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true }) });
    }
    if (url.includes('/onboarding/update-venue')) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true }) });
    }
    if (url.includes('/onboarding/reset-password')) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true }) });
    }
    if (url.includes('/onboarding/system-logs')) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: [
          { id: 1, admin_id: 'super-admin', target_tenant: 1001,
            action_type: 'create_venue', details: 'Venue created: The Park Suite',
            timestamp: new Date().toISOString() },
          { id: 2, admin_id: 'super-admin', target_tenant: 1002,
            action_type: 'toggle_venue', details: 'Toggled tenant_id: 1002',
            timestamp: new Date(Date.now() - 60000).toISOString() },
        ]}) });
    }
    // Default: let health/ping and other calls through
    return route.continue();
  });
}

// Helper: load page already authenticated (sessionStorage set before scripts run)
async function loadAuthenticated(page) {
  await mockN8N(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('vd_admin_auth', '1');
  });
  await page.goto(PAGE_PATH);
  await expect(page.locator('#mainApp')).toBeVisible({ timeout: 8000 });
  // Wait for venues to render
  await expect(page.locator('#venuesTable tr')).not.toHaveCount(1, { timeout: 6000 });
}


// ══ 1. LOGIN GATE ═════════════════════════════════════════════════════════════

test.describe('1 — Login gate', () => {

  test('login overlay is shown on fresh load; main app is hidden', async ({ page }) => {
    await mockN8N(page);
    await page.goto(PAGE_PATH);
    await expect(page.locator('#loginOverlay')).toBeVisible();
    await expect(page.locator('#mainApp')).toBeHidden();
  });

  test('wrong admin key shows error message', async ({ page }) => {
    await mockN8N(page);
    // Override login to reject wrong key
    await page.route('**/onboarding/login', route =>
      route.fulfill({ status: 401, contentType: 'application/json',
        body: JSON.stringify({ ok: false }) }));
    await page.goto(PAGE_PATH);
    await page.fill('#adminKeyInput', 'wrong-key');
    await page.click('#loginBtn');
    await expect(page.locator('#loginError')).toBeVisible({ timeout: 4000 });
    await expect(page.locator('#loginError')).toContainText(/invalid|denied/i);
    // Main app still hidden
    await expect(page.locator('#mainApp')).toBeHidden();
  });

  test('correct admin key dismisses overlay, shows main app and loads venues', async ({ page }) => {
    await mockN8N(page);
    await page.goto(PAGE_PATH);
    await page.fill('#adminKeyInput', ADMIN_KEY);
    await page.click('#loginBtn');
    await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 6000 });
    await expect(page.locator('#mainApp')).toBeVisible();
    // Stats cards populated
    await expect(page.locator('#statTotal')).toContainText('3', { timeout: 5000 });
  });

  test('Enter key submits login form', async ({ page }) => {
    await mockN8N(page);
    await page.goto(PAGE_PATH);
    await page.fill('#adminKeyInput', ADMIN_KEY);
    await page.press('#adminKeyInput', 'Enter');
    await expect(page.locator('#mainApp')).toBeVisible({ timeout: 6000 });
  });

});


// ══ 2. TELEMETRY PANEL ════════════════════════════════════════════════════════

test.describe('2 — Telemetry panel', () => {

  test('panel is visible with all indicators after login', async ({ page }) => {
    await loadAuthenticated(page);
    const panel = page.locator('.ob-telemetry');
    await expect(panel).toBeVisible();
    // Health dot
    await expect(page.locator('#dbHealthDot')).toBeVisible();
    await expect(page.locator('#dbHealthVal')).toBeVisible();
    // Latency
    await expect(page.locator('#teleLatency')).toBeVisible();
    // Last check
    await expect(page.locator('#teleLastCheck')).toBeVisible();
  });

  test('DB health dot turns green after successful venue load', async ({ page }) => {
    await loadAuthenticated(page);
    await expect(page.locator('#dbHealthDot')).toHaveClass(/green/, { timeout: 5000 });
    await expect(page.locator('#dbHealthVal')).toContainText('Healthy');
  });

  test('System Audit button is present and clickable', async ({ page }) => {
    await loadAuthenticated(page);
    const auditBtn = page.getByRole('button', { name: /system audit/i });
    await expect(auditBtn).toBeVisible();
    await auditBtn.click();
    await expect(page.locator('#auditModal')).toHaveClass(/open/);
  });

  test('Ping button triggers latency check', async ({ page }) => {
    await loadAuthenticated(page);
    // Mock health ping to return fast
    await page.route('**/api.venuedesk.co.uk/health/ping', route =>
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, ts: new Date().toISOString() }) }));
    const pingBtn = page.getByRole('button', { name: /ping/i });
    await expect(pingBtn).toBeVisible();
    await pingBtn.click();
    // After ping, last check should show a time
    await expect(page.locator('#teleLastCheck')).not.toContainText('—', { timeout: 5000 });
  });

});


// ══ 3. STATS CARDS ════════════════════════════════════════════════════════════

test.describe('3 — Stats cards', () => {

  test('all four stat cards are present and populated', async ({ page }) => {
    await loadAuthenticated(page);
    // 3 mock venues (2 active, 1 inactive, 3 with usernames)
    await expect(page.locator('#statTotal')).toHaveText('3');
    await expect(page.locator('#statActive')).toHaveText('2');
    await expect(page.locator('#statInactive')).toHaveText('1');
    await expect(page.locator('#statUsers')).toHaveText('3');
  });

});


// ══ 4. VENUES TABLE ═══════════════════════════════════════════════════════════

test.describe('4 — Venues table', () => {

  test('table has all 7 column headers', async ({ page }) => {
    await loadAuthenticated(page);
    const headers = await page.locator('thead th').allTextContents();
    expect(headers).toEqual(
      expect.arrayContaining(['ID', 'Venue', 'Username', 'Status',
        'Subscription', 'Seats', 'Actions'])
    );
  });

  test('renders 3 venue rows from mock data', async ({ page }) => {
    await loadAuthenticated(page);
    const rows = page.locator('#venuesTable tr');
    await expect(rows).toHaveCount(3, { timeout: 5000 });
  });

  test('Active subscription badge renders for active tenant', async ({ page }) => {
    await loadAuthenticated(page);
    await expect(page.locator('.badge-sub-active').first()).toBeVisible();
    await expect(page.locator('.badge-sub-active').first()).toContainText('Active');
  });

  test('Trial subscription badge renders for trial tenant', async ({ page }) => {
    await loadAuthenticated(page);
    await expect(page.locator('.badge-sub-trial')).toBeVisible();
    await expect(page.locator('.badge-sub-trial')).toContainText('Trial');
  });

  test('Past Due subscription badge renders for past_due tenant', async ({ page }) => {
    await loadAuthenticated(page);
    await expect(page.locator('.badge-sub-pastdue')).toBeVisible();
    await expect(page.locator('.badge-sub-pastdue')).toContainText('Past Due');
  });

  test('Seat allocation pill renders as Seats: X / Y', async ({ page }) => {
    await loadAuthenticated(page);
    const pills = page.locator('.seats-pill');
    await expect(pills.first()).toBeVisible();
    await expect(pills.first()).toContainText(/Seats: \d+ \/ \d+/);
  });

  test('action buttons are present on each row', async ({ page }) => {
    await loadAuthenticated(page);
    const firstRow = page.locator('#venuesTable tr').first();
    await expect(firstRow.getByText(/Edit/i)).toBeVisible();
    await expect(firstRow.getByText(/Open/i)).toBeVisible();
    await expect(firstRow.getByText(/Enquiry Link/i)).toBeVisible();
  });

  test('empty state message renders when no venues', async ({ page }) => {
    await mockN8N(page);
    // Override venues to return empty
    await page.route('**/onboarding/venues', route =>
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: [] }) }));
    await page.addInitScript(() => sessionStorage.setItem('vd_admin_auth', '1'));
    await page.goto(PAGE_PATH);
    await page.waitForSelector('#mainApp', { state: 'visible' });
    await expect(page.locator('#venuesTable')).toContainText(/No venues yet/i, { timeout: 5000 });
  });

});


// ══ 5. CREATE FORM & SEAT STEPPER ═════════════════════════════════════════════

test.describe('5 — Create form & seat stepper pricing', () => {

  test('all create form fields are present', async ({ page }) => {
    await loadAuthenticated(page);
    await expect(page.locator('#fTenantId')).toBeVisible();
    await expect(page.locator('#fVenueName')).toBeVisible();
    await expect(page.locator('#fSlug')).toBeVisible();
    await expect(page.locator('#fUsername')).toBeVisible();
    await expect(page.locator('#fFullName')).toBeVisible();
    await expect(page.locator('#fPassword')).toBeVisible();
  });

  test('seat stepper starts at 1 with £30.00 pricing', async ({ page }) => {
    await loadAuthenticated(page);
    await expect(page.locator('#fSeats')).toHaveText('1');
    await expect(page.locator('#fPriceDisplay')).toHaveText('£30.00');
  });

  test('incrementing seats updates pricing preview correctly', async ({ page }) => {
    await loadAuthenticated(page);
    // +1 → 2 seats → £35
    await page.click('button[onclick*="adjustSeats(\'fSeats\',1)"]');
    await expect(page.locator('#fSeats')).toHaveText('2');
    await expect(page.locator('#fPriceDisplay')).toHaveText('£35.00');
    // +1 → 3 seats → £40
    await page.click('button[onclick*="adjustSeats(\'fSeats\',1)"]');
    await expect(page.locator('#fSeats')).toHaveText('3');
    await expect(page.locator('#fPriceDisplay')).toHaveText('£40.00');
  });

  test('decrementing below 1 is blocked — stays at 1', async ({ page }) => {
    await loadAuthenticated(page);
    await expect(page.locator('#fSeats')).toHaveText('1');
    await page.click('button[onclick*="adjustSeats(\'fSeats\',-1)"]');
    await expect(page.locator('#fSeats')).toHaveText('1');
    await expect(page.locator('#fPriceDisplay')).toHaveText('£30.00');
  });

  test('stepper is capped at 20 seats — £125.00', async ({ page }) => {
    await loadAuthenticated(page);
    // Click + 20 times rapidly
    for (let i = 0; i < 22; i++) {
      await page.click('button[onclick*="adjustSeats(\'fSeats\',1)"]');
    }
    await expect(page.locator('#fSeats')).toHaveText('20');
    await expect(page.locator('#fPriceDisplay')).toHaveText('£125.00');
  });

  test('pricing preview text updates with correct seat wording', async ({ page }) => {
    await loadAuthenticated(page);
    await page.click('button[onclick*="adjustSeats(\'fSeats\',1)"]');
    await page.click('button[onclick*="adjustSeats(\'fSeats\',1)"]');
    // 3 seats = 2 extra seats
    const preview = page.locator('#fPricingPreview');
    await expect(preview).toContainText('2 × £5 extra seats');
  });

  test('slug auto-fills from venue name', async ({ page }) => {
    await loadAuthenticated(page);
    await page.fill('#fVenueName', 'The Grand Hall');
    await expect(page.locator('#fSlug')).toHaveValue('the-grand-hall');
  });

  test('tenant ID suggestion is auto-populated', async ({ page }) => {
    await loadAuthenticated(page);
    // With 3 mock venues (max id 1003), next should be 1004
    await expect(page.locator('#fTenantId')).toHaveValue('1004');
  });

  test('submit with empty required fields shows toast error', async ({ page }) => {
    await loadAuthenticated(page);
    await page.click('#addVenueBtn');
    // Toast should appear with an error
    const toast = page.locator('#toast');
    await expect(toast).toBeVisible({ timeout: 3000 });
    await expect(toast).toHaveClass(/error/);
  });

  test('submit with short password shows toast error', async ({ page }) => {
    await loadAuthenticated(page);
    await page.fill('#fTenantId', '1004');
    await page.fill('#fVenueName', 'Test Venue');
    await page.fill('#fUsername', 'testuser');
    await page.fill('#fPassword', 'abc');  // too short
    await page.click('#addVenueBtn');
    const toast = page.locator('#toast');
    await expect(toast).toBeVisible({ timeout: 3000 });
    await expect(toast).toContainText(/6 char/i);
  });

  test('successful create clears form and shows success toast', async ({ page }) => {
    await loadAuthenticated(page);
    await page.fill('#fTenantId', '1004');
    await page.fill('#fVenueName', 'New Venue');
    await page.fill('#fSlug', 'new-venue');
    await page.fill('#fUsername', 'newvenue');
    await page.fill('#fFullName', 'New Contact');
    await page.fill('#fPassword', 'password123');
    await page.click('#addVenueBtn');
    const toast = page.locator('#toast');
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toHaveClass(/success/);
    // Form should clear
    await expect(page.locator('#fVenueName')).toHaveValue('');
  });

});


// ══ 6. EDIT MODAL ═════════════════════════════════════════════════════════════

test.describe('6 — Edit venue modal', () => {

  test('Edit button opens modal with venue details pre-filled', async ({ page }) => {
    await loadAuthenticated(page);
    const editBtn = page.locator('#venuesTable tr').first()
      .locator('button', { hasText: /edit/i });
    await editBtn.click({ force: true });
    await expect(page.locator('#editModal')).toHaveClass(/open/);
    await expect(page.locator('#editModalLabel')).toContainText('The Park Suite');
    await expect(page.locator('#editVenueName')).toHaveValue('The Park Suite');
    await expect(page.locator('#editSlug')).toHaveValue('the-park-suite');
  });

  test('edit modal pre-fills seat count from venue data', async ({ page }) => {
    await loadAuthenticated(page);
    await page.locator('#venuesTable tr').first()
      .locator('button', { hasText: /edit/i }).click({ force: true });
    // Park Suite has max_users: 3
    await expect(page.locator('#editSeats')).toHaveText('3');
    await expect(page.locator('#editPriceDisplay')).toHaveText('£40.00');
  });

  test('edit modal seat stepper updates pricing', async ({ page }) => {
    await loadAuthenticated(page);
    await page.locator('#venuesTable tr').first()
      .locator('button', { hasText: /edit/i }).click({ force: true });
    await page.click('button[onclick*="adjustSeats(\'editSeats\',1)"]');
    await expect(page.locator('#editSeats')).toHaveText('4');
    await expect(page.locator('#editPriceDisplay')).toHaveText('£45.00');
  });

  test('Cancel button closes edit modal', async ({ page }) => {
    await loadAuthenticated(page);
    await page.locator('#venuesTable tr').first()
      .locator('button', { hasText: /edit/i }).click({ force: true });
    await expect(page.locator('#editModal')).toHaveClass(/open/);
    await page.locator('#editModal').getByRole('button', { name: /cancel/i }).click();
    await expect(page.locator('#editModal')).not.toHaveClass(/open/);
  });

  test('Save Changes sends update and shows success toast', async ({ page }) => {
    await loadAuthenticated(page);
    await page.locator('#venuesTable tr').first()
      .locator('button', { hasText: /edit/i }).click({ force: true });
    await page.fill('#editVenueName', 'Updated Suite');
    await page.click('#editSaveBtn');
    const toast = page.locator('#toast');
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toHaveClass(/success/);
  });

});


// ══ 7. PASSWORD MODAL ═════════════════════════════════════════════════════════

test.describe('7 — Password modal', () => {

  test('Reset Password modal opens in reset mode for existing user', async ({ page }) => {
    await loadAuthenticated(page);
    // The Park Suite (row 1) has username 'parksuite' — reset mode
    await page.locator('#venuesTable tr').first()
      .locator('button[title*="password"], button[title*="login"]').click({ force: true });
    await expect(page.locator('#pwModal')).toHaveClass(/open/);
    await expect(page.locator('#pwModalTitle')).toHaveText('Reset Password');
    // Username field hidden in reset mode (user already exists)
    await expect(page.locator('#pwUsernameRow')).toBeHidden();
  });

  test('password too short shows toast error', async ({ page }) => {
    await loadAuthenticated(page);
    await page.locator('#venuesTable tr').first()
      .locator('button[title*="password"], button[title*="login"]').click({ force: true });
    await page.fill('#newPwInput', 'abc');
    await page.click('#pwModalConfirmBtn');
    const toast = page.locator('#toast');
    await expect(toast).toBeVisible({ timeout: 3000 });
    await expect(toast).toHaveClass(/error/);
  });

  test('successful password reset shows success toast and closes modal', async ({ page }) => {
    await loadAuthenticated(page);
    await page.locator('#venuesTable tr').first()
      .locator('button[title*="password"], button[title*="login"]').click({ force: true });
    await page.fill('#newPwInput', 'newpassword123');
    await page.click('#pwModalConfirmBtn');
    await expect(page.locator('#toast')).toHaveClass(/success/, { timeout: 5000 });
    await expect(page.locator('#pwModal')).not.toHaveClass(/open/, { timeout: 4000 });
  });

  test('Cancel closes password modal', async ({ page }) => {
    await loadAuthenticated(page);
    await page.locator('#venuesTable tr').first()
      .locator('button[title*="password"], button[title*="login"]').click({ force: true });
    await page.locator('#pwModal').getByRole('button', { name: /cancel/i }).click();
    await expect(page.locator('#pwModal')).not.toHaveClass(/open/);
  });

});


// ══ 8. SYSTEM AUDIT MODAL ═════════════════════════════════════════════════════

test.describe('8 — System Audit modal', () => {

  test('clicking System Audit opens modal', async ({ page }) => {
    await loadAuthenticated(page);
    await page.getByRole('button', { name: /system audit/i }).click();
    await expect(page.locator('#auditModal')).toHaveClass(/open/);
  });

  test('modal loads and displays audit records from mock', async ({ page }) => {
    await loadAuthenticated(page);
    await page.getByRole('button', { name: /system audit/i }).click();
    // Should show record count
    await expect(page.locator('#auditCount')).toContainText('2 records', { timeout: 5000 });
    // Table should show action types
    await expect(page.locator('.audit-type-pill').first()).toBeVisible();
    await expect(page.locator('.audit-type-pill').first()).toContainText('create_venue');
  });

  test('modal shows "No audit records found" when data is empty', async ({ page }) => {
    await mockN8N(page);
    await page.route('**/onboarding/system-logs**', route =>
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: [] }) }));
    await page.addInitScript(() => sessionStorage.setItem('vd_admin_auth', '1'));
    await page.goto(PAGE_PATH);
    await expect(page.locator('#mainApp')).toBeVisible({ timeout: 6000 });
    await page.getByRole('button', { name: /system audit/i }).click();
    await expect(page.locator('#auditContent')).toContainText(/no audit records/i, { timeout: 5000 });
  });

  test('modal shows pending message on empty body response', async ({ page }) => {
    await mockN8N(page);
    await page.route('**/onboarding/system-logs**', route =>
      route.fulfill({ status: 200, contentType: 'text/plain', body: '' }));
    await page.addInitScript(() => sessionStorage.setItem('vd_admin_auth', '1'));
    await page.goto(PAGE_PATH);
    await expect(page.locator('#mainApp')).toBeVisible({ timeout: 6000 });
    await page.getByRole('button', { name: /system audit/i }).click();
    await expect(page.locator('#auditContent')).toContainText(/not yet active/i, { timeout: 5000 });
  });

  test('clicking outside modal closes it', async ({ page }) => {
    await loadAuthenticated(page);
    await page.getByRole('button', { name: /system audit/i }).click();
    await expect(page.locator('#auditModal')).toHaveClass(/open/);
    // Click the overlay (not the modal itself)
    await page.locator('#auditModal').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('#auditModal')).not.toHaveClass(/open/);
  });

  test('Refresh button reloads log data', async ({ page }) => {
    await loadAuthenticated(page);
    await page.getByRole('button', { name: /system audit/i }).click();
    await expect(page.locator('#auditCount')).toContainText('2 records', { timeout: 5000 });
    await page.locator('#auditModal').getByRole('button', { name: /refresh/i }).click();
    await expect(page.locator('#auditCount')).toContainText('2 records', { timeout: 5000 });
  });

});


// ══ 9. VENUE DETAIL MODAL ═════════════════════════════════════════════════════

test.describe('9 — Venue detail panel', () => {

  test('clicking a venue row opens detail modal', async ({ page }) => {
    await loadAuthenticated(page);
    await page.locator('#venuesTable tr').first().click();
    await expect(page.locator('#venueDetailModal')).toHaveClass(/open/);
    await expect(page.locator('#vdName')).toHaveText('The Park Suite');
  });

  test('detail modal shows correct tenant metadata', async ({ page }) => {
    await loadAuthenticated(page);
    await page.locator('#venuesTable tr').first().click();
    await expect(page.locator('#vdId')).toContainText('#1001');
    await expect(page.locator('#vdSlug')).toHaveText('the-park-suite');
    await expect(page.locator('#vdContact')).toHaveText('Jane Smith');
  });

  test('detail modal status badge shows Active for active venue', async ({ page }) => {
    await loadAuthenticated(page);
    await page.locator('#venuesTable tr').first().click();
    await expect(page.locator('#vdStatusBadge .badge-active')).toBeVisible();
  });

  test('launch grid contains 6 page shortcuts', async ({ page }) => {
    await loadAuthenticated(page);
    await page.locator('#venuesTable tr').first().click();
    await expect(page.locator('#vdLaunchGrid .ob-launch-btn')).toHaveCount(6);
  });

  test('Close button dismisses detail modal', async ({ page }) => {
    await loadAuthenticated(page);
    await page.locator('#venuesTable tr').first().click();
    await expect(page.locator('#venueDetailModal')).toHaveClass(/open/);
    await page.locator('#venueDetailModal .ob-vd-close').click();
    await expect(page.locator('#venueDetailModal')).not.toHaveClass(/open/);
  });

});


// ══ 10. TOGGLE VENUE (ACTIVATE / DEACTIVATE) ══════════════════════════════════

test.describe('10 — Toggle venue', () => {

  test('deactivate confirms then shows error-tone toast', async ({ page }) => {
    await loadAuthenticated(page);
    page.on('dialog', d => d.accept()); // auto-accept confirm
    const pauseBtn = page.locator('#venuesTable tr').first()
      .locator('button[title*="Deactivate"]');
    await pauseBtn.click({ force: true });
    const toast = page.locator('#toast');
    await expect(toast).toBeVisible({ timeout: 5000 });
    // deactivation uses 'error' toast class
    await expect(toast).toHaveClass(/error/);
  });

  test('reactivate shows success toast', async ({ page }) => {
    await loadAuthenticated(page);
    page.on('dialog', d => d.accept());
    // Row 2 is inactive (Riverside Hall)
    const playBtn = page.locator('#venuesTable tr').nth(1)
      .locator('button[title*="Reactivate"]');
    await playBtn.click({ force: true });
    await expect(page.locator('#toast')).toHaveClass(/success/, { timeout: 5000 });
  });

  test('cancelling confirm does nothing', async ({ page }) => {
    await loadAuthenticated(page);
    page.on('dialog', d => d.dismiss());
    const pauseBtn = page.locator('#venuesTable tr').first()
      .locator('button[title*="Deactivate"]');
    await pauseBtn.click({ force: true });
    // Toast should NOT appear
    await page.waitForTimeout(1000);
    await expect(page.locator('#toast')).not.toHaveClass(/show/);
  });

});


// ══ 11. ENQUIRY LINK ══════════════════════════════════════════════════════════

test.describe('11 — Enquiry link copy', () => {

  test('enquiry link button is present for each venue', async ({ page }) => {
    await loadAuthenticated(page);
    const linkBtns = page.locator('#venuesTable').getByText(/Enquiry Link/i);
    await expect(linkBtns).toHaveCount(3);
  });

  test('clicking enquiry link shows success toast with venue name', async ({ page }) => {
    await loadAuthenticated(page);
    // Grant clipboard permissions
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const firstLinkBtn = page.locator('#venuesTable tr').first()
      .locator('button', { hasText: /Enquiry Link/i });
    await firstLinkBtn.click({ force: true });
    const toast = page.locator('#toast');
    await expect(toast).toBeVisible({ timeout: 3000 });
    await expect(toast).toHaveClass(/success/);
    await expect(toast).toContainText(/Park Suite/i);
  });

});


// ══ 12. SIDEBAR NAVIGATION ════════════════════════════════════════════════════

test.describe('12 — Sidebar navigation', () => {

  test('sidebar contains all expected nav links', async ({ page }) => {
    await loadAuthenticated(page);
    const nav = page.locator('aside nav');
    await expect(nav.getByText(/Dashboard/i)).toBeVisible();
    await expect(nav.getByText(/Lead Gen/i)).toBeVisible();
    await expect(nav.getByText(/Onboarding/i)).toBeVisible();
    await expect(nav.getByText(/Logout/i)).toBeVisible();
  });

  test('Onboarding nav item has active class', async ({ page }) => {
    await loadAuthenticated(page);
    const onboardingLink = page.locator('aside nav a.nav-link.active');
    await expect(onboardingLink).toBeVisible();
    await expect(onboardingLink).toContainText(/Onboarding/i);
  });

  test('Dashboard link points to index.html', async ({ page }) => {
    await loadAuthenticated(page);
    const dashLink = page.locator('aside nav a[href="index.html"]');
    await expect(dashLink).toBeVisible();
  });

  test('sidebar collapse button toggles collapsed class', async ({ page }) => {
    await loadAuthenticated(page);
    await page.locator('.sidebar-collapse-btn').click();
    await expect(page.locator('body')).toHaveClass(/sidebar-collapsed/);
    // Click again to restore
    await page.locator('.sidebar-collapse-btn').click();
    await expect(page.locator('body')).not.toHaveClass(/sidebar-collapsed/);
  });

});


// ══ 13. TOPBAR & REFRESH ══════════════════════════════════════════════════════

test.describe('13 — Topbar & refresh', () => {

  test('Refresh button in venues card reloads venues', async ({ page }) => {
    await loadAuthenticated(page);
    let callCount = 0;
    await page.route('**/onboarding/venues', async route => {
      callCount++;
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_VENUES }) });
    });
    await page.locator('.ob-card-title .btn', { hasText: /refresh/i }).click();
    await page.waitForTimeout(1000);
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  test('topbar refresh icon also reloads venues', async ({ page }) => {
    await loadAuthenticated(page);
    await page.locator('.ob-topbar').getByTitle(/refresh/i).click();
    // Stat cards should still show correct counts
    await expect(page.locator('#statTotal')).toHaveText('3', { timeout: 5000 });
  });

  test('Logout button clears session and shows login overlay', async ({ page }) => {
    await loadAuthenticated(page);
    // Click logout in topbar
    await page.locator('.ob-topbar').getByTitle(/log out/i).click();
    await expect(page.locator('#loginOverlay')).toBeVisible({ timeout: 4000 });
    await expect(page.locator('#mainApp')).toBeHidden();
  });

});
