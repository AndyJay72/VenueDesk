const { chromium } = require('@playwright/test');
const path = require('path');

const BASE = 'https://venuedesk.co.uk';
const OUT  = path.join(__dirname, '../../screenshots/calendar-walkin.png');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx  = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // Log in
  console.log('Logging in…');
  await page.goto(`${BASE}/login.html`, { waitUntil: 'networkidle' });
  await page.locator('#username, input[name="username"], input[type="text"]').first().fill('arj72');
  await page.locator('input[type="password"]').first().fill('VenueDesk2026!');
  await page.locator('button[type="submit"], .login-btn, #loginBtn').first().click();
  await page.waitForURL(/(?!.*login)/, { timeout: 10000 });
  await page.waitForTimeout(1500);

  // Navigate to calendar
  console.log('Loading calendar…');
  await page.goto(`${BASE}/calendar.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.fc-daygrid-day', { timeout: 10000 });
  await page.waitForTimeout(2000);

  // Find the first empty future date via JS, then use Playwright's native click
  const emptyDate = await page.evaluate(() => {
    const today = new Date();
    const cells = Array.from(document.querySelectorAll('.fc-daygrid-day'));
    for (const cell of cells) {
      const dateStr = cell.getAttribute('data-date');
      if (!dateStr) continue;
      if (new Date(dateStr) > today && cell.querySelectorAll('.fc-event').length === 0) {
        return dateStr;
      }
    }
    return null;
  });
  console.log('Targeting empty date:', emptyDate);

  // Use Playwright's real pointer click on the day cell
  await page.locator(`.fc-daygrid-day[data-date="${emptyDate}"] .fc-daygrid-day-frame`)
            .click({ force: true });

  // Wait for drawer/modal to appear
  await page.waitForTimeout(3000);

  // Take screenshot
  await page.screenshot({ path: OUT, fullPage: false });
  console.log('Saved:', OUT);
  await browser.close();
})();
