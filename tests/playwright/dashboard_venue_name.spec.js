/**
 * dashboard_venue_name.spec.js
 *
 * Verifies that the venue name appears in the index.html dashboard header
 * via loadVenueName() → GET /stripe/config?tenant_id=N.
 *
 * Regression for: style.display='' bug (dd12ec4) — CSS display:none cannot
 * be overridden by clearing inline style; must set explicit 'block'.
 */

const { test, expect } = require('@playwright/test');

function makeToken() {
  const b64url = s => Buffer.from(s).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    id: 'test-user-001', user_id: 'test-user-001',
    username: 'arj72', full_name: 'Andrew Johnson', name: 'Andrew Johnson',
    role: 'admin', tenant_id: 1001,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
  }));
  return `${header}.${payload}.fakesig`;
}

async function injectSession(page) {
  const token = makeToken();
  await page.addInitScript(({ tok }) => {
    sessionStorage.setItem('vp_token',     tok);
    sessionStorage.setItem('vp_tenant_id', '1001');
    sessionStorage.setItem('vp_user_name', 'Andrew Johnson');
    sessionStorage.setItem('vp_user', JSON.stringify({
      id: 'test-user-001', user_id: 'test-user-001',
      username: 'arj72', full_name: 'Andrew Johnson',
      tenant_id: 1001, role: 'admin',
    }));
  }, { tok: token });
}

async function mockAPIs(page, venueName = 'Hayward') {
  // Catch-alls first (LIFO — registered last wins, so specifics come after)
  await page.route('**/n8n.srv1090894.hstgr.cloud/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: { metrics: {}, transactions: [], requests: [], bookings: [] } }) }));

  await page.route('**/api.venuedesk.co.uk/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }) }));

  // Specific override for stripe/config (wins via LIFO)
  await page.route('**/api.venuedesk.co.uk/stripe/config**', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, data: {
        venue_name: venueName, is_stripe_enabled: false,
      }}) }));
}

test('venue name shows in header when API returns venue_name', async ({ page }) => {
  await injectSession(page);
  await mockAPIs(page, 'Hayward');
  await page.goto('http://localhost:7171/index.html');

  // Wait for the async loadVenueName() fetch to resolve and set display:block
  await page.waitForFunction(() => {
    const el = document.getElementById('hdr-venue-line');
    return el && el.style.display === 'block';
  }, { timeout: 5000 });

  await expect(page.locator('#hdr-venue-line')).toBeVisible();
  await expect(page.locator('#hdr-venue-name')).toHaveText('Hayward');
  // Welcome text unaffected
  await expect(page.locator('#hdr-username')).toHaveText('Andrew Johnson');
});

test('venue line stays hidden when API returns no venue_name', async ({ page }) => {
  await injectSession(page);
  await mockAPIs(page, null);
  await page.goto('http://localhost:7171/index.html');
  await page.waitForTimeout(700);
  await expect(page.locator('#hdr-venue-line')).toBeHidden();
});
