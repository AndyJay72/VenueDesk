const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx  = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await page.goto('https://venuedesk.co.uk/login.html', { waitUntil: 'networkidle' });
  await page.locator('#username, input[type="text"]').first().fill('arj72');
  await page.locator('input[type="password"]').first().fill('VenueDesk2026!');
  await page.locator('button[type="submit"], .login-btn, #loginBtn').first().click();
  await page.waitForURL(/(?!.*login)/, { timeout: 10000 });
  await page.waitForTimeout(6000);

  // Inspect JS globals to find where Seety lives
  const state = await page.evaluate(() => {
    const findSeety = arr => (arr || []).filter(i =>
      (i.full_name || i.customer_name || '').toLowerCase().includes('seety')
    );

    return {
      inAllOutstandingPayments: findSeety(window.allOutstandingPayments || []),
      inAllRequests:            findSeety(window.allRequests || []),
      inAllUpcomingEvents:      findSeety(window.allUpcomingEvents || []),
      allOutstandingCount:      (window.allOutstandingPayments || []).length,
      allRequestsCount:         (window.allRequests || []).length,
      allUpcomingCount:         (window.allUpcomingEvents || []).length,
    };
  });

  console.log('\n=== JS State ===');
  console.log('allOutstandingPayments count:', state.allOutstandingCount);
  console.log('allRequests count:', state.allRequestsCount);
  console.log('allUpcomingEvents count:', state.allUpcomingCount);

  console.log('\n=== Seety in allOutstandingPayments ===');
  state.inAllOutstandingPayments.forEach(i =>
    console.log(JSON.stringify({ id: i.id, customer_id: i.customer_id, name: i.full_name||i.customer_name, status: i.status, balance: i.balance_due, date: i.booking_date||i.date_from }))
  );

  console.log('\n=== Seety in allRequests ===');
  state.inAllRequests.forEach(i =>
    console.log(JSON.stringify({ id: i.id, customer_id: i.customer_id, name: i.full_name||i.customer_name, status: i.status, balance: i.balance_due, date: i.event_date||i.requested_date||i.booking_date }))
  );

  console.log('\n=== Seety in allUpcomingEvents ===');
  state.inAllUpcomingEvents.forEach(i =>
    console.log(JSON.stringify({ id: i.id, customer_id: i.customer_id, name: i.full_name||i.customer_name, status: i.status, balance: i.balance_due, date: i.booking_date||i.date_from }))
  );

  await browser.close();
})();
