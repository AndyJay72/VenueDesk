/**
 * Logs in to venuedesk.co.uk and captures full-page screenshots
 * of every key dashboard page for use in the demo video.
 */

const { chromium } = require('@playwright/test');
const path = require('path');
const fs   = require('fs');

const BASE     = 'https://venuedesk.co.uk';
const USERNAME = 'arj72';
const PASSWORD = 'VenueDesk2026!';
const OUT_DIR  = path.join(__dirname, '../../screenshots');

const PAGES = [
  { slug: 'dashboard',        url: `${BASE}/index.html`,                  wait: '#statsCards, .stat-card, .kpi-card, [class*="stat"]', clip: null },
  { slug: 'calendar',         url: `${BASE}/calendar.html`,               wait: '.fc, #calendar, [class*="calendar"]',                 clip: null },
  { slug: 'customers',        url: `${BASE}/customers.html`,              wait: '#customersTable, table, .customer-row',               clip: null },
  { slug: 'accounts',         url: `${BASE}/accounts.html`,               wait: '#accountsTable, table, .accounts',                    clip: null },
  { slug: 'enquiry-form',     url: `${BASE}/enquiry-form.html?t=1001`,    wait: '#enquiryForm, form',                                  clip: null },
  { slug: 'admin-config',     url: `${BASE}/admin-config.html`,           wait: '.tab-btn, .config-tab, [data-tab]',                   clip: null },
  { slug: 'manual-booking',   url: `${BASE}/manual-booking.html`,         wait: 'form, #bookingForm, .booking-form',                   clip: null },
  { slug: 'recurring',        url: `${BASE}/recurring-bookings.html`,     wait: 'table, .recurring, #recurringTable',                  clip: null },
];

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx     = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();

  // ── login ──────────────────────────────────────────────────────────────────
  console.log('Logging in …');
  await page.goto(`${BASE}/login.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Try common field selectors
  const userSel = '#username, input[name="username"], input[type="text"]:first-of-type, input[placeholder*="sername"]';
  const passSel = '#password, input[name="password"], input[type="password"]';

  await page.locator(userSel).first().fill(USERNAME);
  await page.locator(passSel).first().fill(PASSWORD);
  await page.locator('button[type="submit"], input[type="submit"], .login-btn, #loginBtn').first().click();

  // Wait for redirect away from login page
  await page.waitForURL(url => !url.includes('login'), { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);
  console.log('Logged in — current URL:', page.url());

  // ── screenshots ───────────────────────────────────────────────────────────
  for (const pg of PAGES) {
    console.log(`Capturing ${pg.slug} …`);
    await page.goto(pg.url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);

    // Try to wait for a key element; don't fail if missing (redirect pages, etc.)
    if (pg.wait) {
      await page.locator(pg.wait).first().waitFor({ state: 'visible', timeout: 6000 })
        .catch(() => console.log(`  ⚠ wait selector not found for ${pg.slug} — screenshotting anyway`));
    }
    await page.waitForTimeout(500);

    const file = path.join(OUT_DIR, `${pg.slug}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`  ✓ saved ${file}`);
  }

  await browser.close();
  console.log('\nDone. Screenshots in:', OUT_DIR);
}

run().catch(err => { console.error(err); process.exit(1); });
