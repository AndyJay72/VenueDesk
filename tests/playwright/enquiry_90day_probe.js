const { chromium } = require('playwright');
const URL = 'https://andyjay72.github.io/VenueDesk/enquiry-form.html?t=1001';
const addDays = n => { const d = new Date(); d.setDate(d.getDate()+n); return d.toISOString().split('T')[0]; };

(async () => {
  // Test against LOCAL file (not GH Pages) so we don't need to wait for CDN
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Serve local file
  await page.goto('file:///Users/andrewjohnson/Downloads/venue_desk_backup/enquiry-form.html?t=1001',
    { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  await page.selectOption('#roomName', { index: 1 }).catch(() => {});
  await page.waitForTimeout(200);
  await page.locator('#multiDayToggle').click();
  await page.waitForTimeout(200);
  await page.selectOption('#timeFrom', '09:00');
  await page.selectOption('#timeTo',   '17:00');

  // ── 91-day span — must be blocked ────────────────────────────────
  await page.fill('#dateFrom', addDays(10));
  await page.fill('#dateTo',   addDays(101));
  await page.waitForTimeout(1500);
  const c91 = await page.locator('#availStatus').getAttribute('class');
  const t91 = await page.locator('#availText').textContent();
  console.log(c91.includes('unavailable') ? '✅' : '❌',
    '91-day span blocked:', t91.trim());

  // ── 90-day span — must NOT be blocked ────────────────────────────
  await page.fill('#dateTo', addDays(99)); // 10→99 = 90 days inclusive
  await page.waitForTimeout(2500);
  const c90 = await page.locator('#availStatus').getAttribute('class');
  const t90 = await page.locator('#availText').textContent();
  console.log(!c90.includes('unavailable') ? '✅' : '❌',
    '90-day span allowed:', t90.trim());

  // ── 3-day span — still works as before ───────────────────────────
  await page.fill('#dateFrom', addDays(21));
  await page.fill('#dateTo',   addDays(23));
  await page.waitForTimeout(2500);
  const c3 = await page.locator('#availStatus').getAttribute('class');
  const t3 = await page.locator('#availText').textContent();
  console.log(!c3.includes('unavailable') || c3.includes('available') ? '✅' : '❌',
    '3-day span:', t3.trim());

  await browser.close();
})();
