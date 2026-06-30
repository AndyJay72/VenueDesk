const { chromium } = require('playwright');

const LOCAL = 'file:///Users/andrewjohnson/Downloads/venue_desk_backup/enquiry-form.html?t=1001';
const DB_API = 'https://api.venuedesk.co.uk';

const addDays = n => { const d = new Date(); d.setDate(d.getDate()+n); return d.toISOString().split('T')[0]; };
const FUTURE = addDays(30);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pass = [], warn = [], fail = [];
  const log = (icon, label, detail='') => {
    const line = `${icon} ${label}${detail ? ': '+detail : ''}`;
    console.log(line);
    if (icon==='✅') pass.push(line); else if (icon==='❌') fail.push(line); else warn.push(line);
  };

  // ── Phase 1: API smoke tests (before browser) ──────────────────
  console.log('\n── Phase 1: API chain ──');

  // 1a. POST /enquiry/create-request — get a real booking_request_id
  const eRes = await fetch(`${DB_API}/enquiry/create-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Stripe Test', email: 'stripe@test.com', phone: '07700999000',
      customer_name: 'Stripe Test', customer_email: 'stripe@test.com', customer_phone: '07700999000',
      room_name: 'Football Pitch', event_type: 'Private Party',
      booking_date: FUTURE, date_from: FUTURE, date_to: FUTURE, event_date: FUTURE,
      start_time: '10:00', end_time: '12:00',
      guest_count: 5, hire_type: 'hourly',
      total_amount: 40, balance_due: 40, payment_amount: 0,
      payment_type: 'none', payment_method: 'Enquiry / Stripe Pending',
      deposit_intent: true, deposit_amount: 10,
      booking_source: 'enquiry', status: 'pending_deposit', tenant_id: 1001,
    }),
  });
  const ej = await eRes.json().catch(() => ({}));
  if (eRes.ok && ej.success && ej.booking_request_id) {
    log('✅', 'POST /enquiry/create-request', `booking_request_id=${ej.booking_request_id}`);
  } else {
    log('❌', 'POST /enquiry/create-request', `status=${eRes.status} ${JSON.stringify(ej)}`);
  }
  const bookingReqId = ej.booking_request_id || null;

  // 1b. POST /stripe/public-session with the real booking_request_id
  if (bookingReqId) {
    const sRes = await fetch(`${DB_API}/stripe/public-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: 1001, amount: 10,
        booking_request_id: bookingReqId,
        description: 'Deposit — Private Party at Football Pitch on ' + FUTURE,
        success_url: 'https://andyjay72.github.io/VenueDesk/checkout.html?session_id={CHECKOUT_SESSION_ID}',
        cancel_url:  'https://andyjay72.github.io/VenueDesk/enquiry-form.html?t=1001',
      }),
    });
    const sj = await sRes.json().catch(() => ({}));
    if (sRes.ok && sj.url && sj.url.includes('checkout.stripe.com')) {
      log('✅', 'POST /stripe/public-session', `Stripe URL returned (${sj.url.slice(0,60)}...)`);
    } else {
      log('❌', 'POST /stripe/public-session', `status=${sRes.status} url=${sj.url||'none'} ${JSON.stringify(sj)}`);
    }
  } else {
    log('⚠️', 'POST /stripe/public-session', 'skipped — no booking_request_id from step 1a');
  }

  // 1c. Amount bounds: £9 (below £10 floor) — must be rejected
  const lowRes = await fetch(`${DB_API}/stripe/public-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenant_id: 1001, amount: 9,
      booking_request_id: bookingReqId || '00000000-0000-0000-0000-000000000001',
      description: 'test', success_url: 'https://example.com', cancel_url: 'https://example.com',
    }),
  });
  log(lowRes.status === 400 ? '✅' : '❌', 'Amount £9 rejected (below £10 floor)', `HTTP ${lowRes.status}`);

  // 1d. Amount £501 (above £500 ceiling) — must be rejected
  const highRes = await fetch(`${DB_API}/stripe/public-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenant_id: 1001, amount: 501,
      booking_request_id: bookingReqId || '00000000-0000-0000-0000-000000000001',
      description: 'test', success_url: 'https://example.com', cancel_url: 'https://example.com',
    }),
  });
  log(highRes.status === 400 ? '✅' : '❌', 'Amount £501 rejected (above £500 ceiling)', `HTTP ${highRes.status}`);

  // ── Phase 2: Browser UI + deposit button flow ──────────────────
  console.log('\n── Phase 2: Browser UI ──');

  // Intercept public-session in the browser — capture payload, return mock Stripe URL
  // (avoids actual Stripe navigation while still running the full client-side code path)
  let capturedSessionPayload = null;
  let capturedEnquiryPayload = null;
  const MOCK_STRIPE_URL = 'https://checkout.stripe.com/c/pay/mock_test_session#fidkdWxOYHwnPyd1blpxYHZwaWkzTTBQSmxEXzBSNjJhMlV';

  await page.route('**/stripe/public-session', async route => {
    capturedSessionPayload = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ url: MOCK_STRIPE_URL }) });
  });

  await page.route('**/enquiry/create-request', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    capturedEnquiryPayload = body;
    // Let it pass through to the real API
    await route.continue();
  });

  // Block the actual Stripe navigation so test stays alive
  let navigatedToStripe = false;
  await page.route('https://checkout.stripe.com/**', async route => {
    navigatedToStripe = true;
    await route.abort();
  });

  await page.goto(LOCAL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // ── 2a. Deposit button visible (Stripe enabled for tenant 1001) ─
  const depVisible = await page.locator('#depositBtn').isVisible();
  log(depVisible ? '✅' : '❌', 'Deposit button visible on load', String(depVisible));

  // ── 2b. Deposit button disabled before availability check ────────
  const depDisabledInit = await page.locator('#depositBtn').isDisabled();
  log(depDisabledInit ? '✅' : '❌', 'Deposit button disabled initially', String(depDisabledInit));

  // ── 2c. Fill form & check availability ──────────────────────────
  await page.fill('#name',    'Stripe Browser Test');
  await page.fill('#email',   'stripe-browser@test.com');
  await page.fill('#phone',   '07700 888777');
  await page.selectOption('#roomName',  { index: 1 }); // Football Pitch £20/hr
  await page.waitForTimeout(300);
  await page.selectOption('#eventType', { index: 1 });
  await page.fill('#eventDate', addDays(35));
  await page.selectOption('#timeFrom', '10:00');
  await page.selectOption('#timeTo',   '12:00');  // 2h × £20 = £40 → 20% = £8 deposit
  await page.fill('#numPeople', '5');
  await page.waitForTimeout(3500); // availability debounce + API

  const availClass = await page.locator('#availStatus').getAttribute('class');
  log(availClass.includes('available') ? '✅' : '⚠️', 'Availability confirmed', availClass.includes('available') ? 'available' : 'unavailable');

  // ── 2d. Deposit button enabled + amount shown ────────────────────
  const depDisabledAfter = await page.locator('#depositBtn').isDisabled();
  const depLabel = await page.locator('#depositBtn span').textContent().catch(() => '');
  const depNoteVisible = await page.locator('#depositNote').isVisible();
  // £40 total × 20% = £8 (within £10–£500 → clamped to £10)
  const expectedDeposit = '£10.00'; // 20% of £40 = £8, floored to £10
  log(!depDisabledAfter ? '✅' : '⚠️', 'Deposit button enabled after avail check', depLabel.trim());
  log(depLabel.includes('£') ? '✅' : '❌', 'Deposit amount shown on button', depLabel.trim());
  log(depLabel.includes(expectedDeposit) ? '✅' : '🔍',
    `Deposit amount is ${expectedDeposit} (20% of £40, floor £10)`, depLabel.trim());
  log(depNoteVisible ? '✅' : '❌', 'Deposit note visible', String(depNoteVisible));

  // ── 2e. Click deposit → spinner, API calls, Stripe redirect ─────
  const navPromise = page.waitForNavigation({ timeout: 12000, waitUntil: 'commit' }).catch(() => null);
  await page.locator('#depositBtn').click();
  await navPromise;
  await page.waitForTimeout(2000);

  // Check the Stripe navigation was attempted
  const finalUrl = page.url();
  const wentToStripe = finalUrl.includes('checkout.stripe.com') || navigatedToStripe;
  log(wentToStripe ? '✅' : '❌', 'Navigation attempted to Stripe checkout', finalUrl.slice(0, 70));

  // Verify create-request payload has deposit_intent=true
  if (capturedEnquiryPayload) {
    log(capturedEnquiryPayload.deposit_intent === true ? '✅' : '❌',
      'create-request payload: deposit_intent=true', String(capturedEnquiryPayload.deposit_intent));
    log(capturedEnquiryPayload.status === 'pending_deposit' ? '✅' : '❌',
      'create-request payload: status=pending_deposit', capturedEnquiryPayload.status);
    log(capturedEnquiryPayload.payment_method === 'Enquiry / Stripe Pending' ? '✅' : '❌',
      'create-request payload: payment_method', capturedEnquiryPayload.payment_method);
  } else {
    log('⚠️', 'create-request payload', 'not captured (may have been too fast)');
  }

  // Verify public-session payload
  if (capturedSessionPayload) {
    log(capturedSessionPayload.tenant_id === 1001 ? '✅' : '❌',
      'public-session payload: tenant_id=1001', String(capturedSessionPayload.tenant_id));
    log(capturedSessionPayload.booking_request_id ? '✅' : '❌',
      'public-session payload: booking_request_id present', capturedSessionPayload.booking_request_id);
    const depAmt = parseFloat(capturedSessionPayload.amount);
    log(depAmt >= 10 && depAmt <= 500 ? '✅' : '❌',
      `public-session payload: amount in £10–£500 bounds`, `£${depAmt}`);
    log(capturedSessionPayload.success_url?.includes('checkout.html') ? '✅' : '❌',
      'public-session payload: success_url → checkout.html', capturedSessionPayload.success_url);
  } else {
    log('⚠️', 'public-session payload', 'not captured');
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log('\n─── Summary ───');
  [...pass, ...warn, ...fail].forEach(l => console.log(l));
  console.log(`\n${pass.length} PASS · ${warn.length} WARN · ${fail.length} FAIL`);

  await browser.close();
  process.exit(fail.length > 0 ? 1 : 0);
})();
