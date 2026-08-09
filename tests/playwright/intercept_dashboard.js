const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx  = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const captured = [];

  // Intercept ALL XHR/fetch responses
  page.on('response', async resp => {
    const url = resp.url();
    if (!url.includes('n8n.srv') && !url.includes('api.venuedesk')) return;
    try {
      const json = await resp.json();
      const items = json.data || (Array.isArray(json) ? json : Object.values(json).find(v => Array.isArray(v)) || []);
      const seety = Array.isArray(items)
        ? items.filter(i => JSON.stringify(i).toLowerCase().includes('seety'))
        : [];
      if (seety.length) {
        captured.push({ url: url.split('?')[0], seety });
      }
    } catch(e) {}
  });

  await page.goto('https://venuedesk.co.uk/login.html', { waitUntil: 'networkidle' });
  await page.locator('#username, input[type="text"]').first().fill('arj72');
  await page.locator('input[type="password"]').first().fill('VenueDesk2026!');
  await page.locator('button[type="submit"], .login-btn, #loginBtn').first().click();
  await page.waitForURL(/(?!.*login)/, { timeout: 10000 });
  await page.waitForTimeout(7000);

  if (captured.length === 0) {
    console.log('No API endpoint returned Seety entries — checking n8n staff-dashboard directly...');
    // Try calling staff-dashboard manually
    const tok = await page.evaluate(() => sessionStorage.getItem('vp_token'));
    const res = await page.evaluate(async (token) => {
      const r = await fetch('https://n8n.srv1090894.hstgr.cloud/webhook/staff-dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jwt: token })
      });
      return r.json();
    }, tok);
    const allItems = Object.values(res.data || res).flat().filter(v => typeof v === 'object' && v !== null);
    const seety = allItems.filter(i => JSON.stringify(i).toLowerCase().includes('seety'));
    if (seety.length) {
      console.log('FOUND in staff-dashboard:');
      seety.forEach(i => console.log(JSON.stringify({ id: i.id, name: i.full_name||i.customer_name, status: i.status, event_date: i.event_date||i.booking_date||i.date_from, has_booking: i.has_booking })));
    } else {
      console.log('Not in staff-dashboard either.');
      // Check recent_customers
      const recent = (res.data||res).recent_customers || [];
      const seety2 = recent.filter(i => JSON.stringify(i).toLowerCase().includes('seety'));
      console.log('In recent_customers:', seety2.length);
      seety2.forEach(i => console.log(JSON.stringify(i)));
    }
  } else {
    captured.forEach(({ url, seety }) => {
      console.log(`\n=== SEETY in ${url} ===`);
      seety.forEach(i => console.log(JSON.stringify({ id: i.id, name: i.full_name||i.customer_name, status: i.status, balance: i.balance_due, date: i.booking_date||i.date_from||i.event_date, has_booking: i.has_booking })));
    });
  }

  await browser.close();
})();
