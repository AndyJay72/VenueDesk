const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx  = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // Capture network responses for key endpoints
  const responses = {};
  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('get-outstanding') || url.includes('staff-dashboard') || url.includes('outstanding-payments')) {
      try {
        const json = await resp.json();
        responses[url] = json;
      } catch(e) {}
    }
  });

  // Log in
  await page.goto('https://venuedesk.co.uk/login.html', { waitUntil: 'networkidle' });
  await page.locator('#username, input[type="text"]').first().fill('arj72');
  await page.locator('input[type="password"]').first().fill('VenueDesk2026!');
  await page.locator('button[type="submit"], .login-btn, #loginBtn').first().click();
  await page.waitForURL(/(?!.*login)/, { timeout: 10000 });
  await page.waitForTimeout(5000); // wait for all dashboard calls to complete

  // Screenshot
  await page.screenshot({ path: '/tmp/dashboard_outstanding.png', fullPage: false });

  // Read the outstanding panel DOM
  const panelHtml = await page.locator('#outstanding-panel-list').innerHTML();
  console.log('\n=== Outstanding Panel HTML ===');
  console.log(panelHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g,' ').trim().slice(0, 1000));

  // Check the pending requests panel
  const pendingHtml = await page.locator('#pending-list, #pending-panel-list, #pendingList').first().innerHTML().catch(() => '(not found)');
  console.log('\n=== Pending Requests Panel HTML ===');
  console.log(pendingHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g,' ').trim().slice(0, 500));

  // Print captured API responses
  for (const [url, data] of Object.entries(responses)) {
    const items = data?.data || (Array.isArray(data) ? data : []);
    const seety = items.filter(i => (i.full_name||i.customer_name||'').toLowerCase().includes('seety'));
    if (seety.length) {
      console.log(`\n=== SEETY found in ${url} ===`);
      seety.forEach(i => console.log(JSON.stringify({
        id: i.id, customer_id: i.customer_id,
        name: i.full_name||i.customer_name,
        status: i.status, balance: i.balance_due,
        date: i.booking_date||i.date_from, type: i.booking_type
      })));
    } else if (url.includes('outstanding')) {
      console.log(`\n=== ${url} — no Seety entries (${items.length} total items) ===`);
    }
  }

  await browser.close();
})();
