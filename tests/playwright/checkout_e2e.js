const { chromium } = require('playwright');

const LOCAL = p => `file:///Users/andrewjohnson/Downloads/venue_desk_backup/checkout.html${p}`;
const BOOKING_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pass = [], warn = [], fail = [];
  const log = (icon, label, detail='') => {
    const line = `${icon} ${label}${detail ? ': '+detail : ''}`;
    console.log(line);
    if (icon==='✅') pass.push(line);
    else if (icon==='❌') fail.push(line);
    else warn.push(line);
  };

  // ── 1. Default state (no params) ──────────────────────────────────
  await page.goto(LOCAL(''), { waitUntil: 'domcontentloaded' });
  log((await page.title()) === 'Payment Received | VenueDesk' ? '✅' : '❌',
    'Page title', await page.title());
  log((await page.locator('h1').textContent()).trim() === 'Payment Received' ? '✅' : '❌',
    'Heading', await page.locator('h1').textContent());
  log((await page.locator('#venue-name').textContent()) === 'our venue' ? '✅' : '❌',
    'Default venue name', await page.locator('#venue-name').textContent());
  log(await page.locator('#meta-strip').evaluate(el => el.classList.contains('hidden')) ? '✅' : '❌',
    'Meta strip hidden by default');
  log(await page.locator('#btn-dashboard').isHidden() ? '✅' : '❌',
    'Dashboard button hidden (no session)');
  log(await page.locator('#btn-public').isVisible() ? '✅' : '❌',
    'Close Window button visible (public customer)');
  log((await page.locator('#btn-public').getAttribute('href') || '').includes('enquiry-form') ? '✅' : '❌',
    'Close Window href', await page.locator('#btn-public').getAttribute('href'));

  // ── 2. ?venue= param populates venue name ─────────────────────────
  await page.goto(LOCAL('?venue=The+Grand+Hall'), { waitUntil: 'domcontentloaded' });
  const venueName = await page.locator('#venue-name').textContent();
  log(venueName === 'The Grand Hall' ? '✅' : '❌', '?venue= param', `"${venueName}"`);

  // ── 3. ?booking= param shows meta strip ───────────────────────────
  await page.goto(LOCAL(`?booking=${BOOKING_ID}`), { waitUntil: 'domcontentloaded' });
  const metaHidden = await page.locator('#meta-strip').evaluate(el => el.classList.contains('hidden'));
  const metaId = await page.locator('#meta-booking-id').textContent();
  log(!metaHidden ? '✅' : '❌', '?booking= shows meta strip');
  log(metaId === BOOKING_ID ? '✅' : '❌', '?booking= value in strip', metaId);

  // ── 4. Both params together ────────────────────────────────────────
  await page.goto(LOCAL(`?venue=Test+Venue&booking=${BOOKING_ID}`), { waitUntil: 'domcontentloaded' });
  const v2 = await page.locator('#venue-name').textContent();
  const b2 = await page.locator('#meta-booking-id').textContent();
  const m2 = await page.locator('#meta-strip').evaluate(el => el.classList.contains('hidden'));
  log(v2 === 'Test Venue' && b2 === BOOKING_ID && !m2 ? '✅' : '❌',
    '?venue=+?booking= together', `venue="${v2}", booking="${b2}", strip visible=${!m2}`);

  // ── 5. Stripe redirect (?session_id=...) — page still loads clean ─
  await page.goto(LOCAL('?session_id=cs_test_a1B2c3D4e5F6g7H8i9J0'), { waitUntil: 'domcontentloaded' });
  const h1Text = await page.locator('h1').textContent();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(e.message));
  log(h1Text.trim() === 'Payment Received' ? '✅' : '❌',
    'Stripe ?session_id= — page loads cleanly', h1Text.trim());
  log(jsErrors.length === 0 ? '✅' : '❌',
    'No JS errors with session_id param', jsErrors.join(', ') || 'none');

  // ── 6. Staff path — vp_token in sessionStorage shows dashboard btn ─
  await page.goto(LOCAL(''), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => sessionStorage.setItem('vp_token', 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6InRlc3QiLCJ0ZW5hbnRfaWQiOjEwMDEsInJvbGUiOiJhZG1pbiJ9.fake'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  const dashVisible = await page.locator('#btn-dashboard').isVisible();
  const closeHidden = await page.locator('#btn-public').isHidden();
  log(dashVisible ? '✅' : '❌', 'Staff path: Back to Dashboard visible');
  log(closeHidden ? '✅' : '❌', 'Staff path: Close Window hidden');
  log((await page.locator('#btn-dashboard').getAttribute('href')) === 'index.html' ? '✅' : '❌',
    'Dashboard href', await page.locator('#btn-dashboard').getAttribute('href'));
  await page.evaluate(() => sessionStorage.clear());

  // ── 7. XSS probe — ?venue= uses textContent (safe) ────────────────
  await page.goto(LOCAL('?venue=%3Cimg+src%3Dx+onerror%3Dalert(1)%3E'), { waitUntil: 'domcontentloaded' });
  const xssHtml      = await page.locator('#venue-name').innerHTML();
  const imgInjected  = await page.locator('#venue-name img').count();
  const xssAlertFired = jsErrors.some(e => e.includes('alert'));
  // Safe: no <img> element in DOM, innerHTML HTML-escaped, no alert
  const xssSafe = imgInjected === 0 && xssHtml.includes('&lt;') && !xssAlertFired;
  log(xssSafe ? '✅' : '❌', 'XSS probe: venue name HTML-escaped, no element injected',
    `img injected=${imgInjected}, innerHTML="${xssHtml.slice(0,40)}"`);

  // ── 8. Special chars in venue name ────────────────────────────────
  await page.goto(LOCAL("?venue=O%27Brien%27s+%26+Sons"), { waitUntil: 'domcontentloaded' });
  const specialName = await page.locator('#venue-name').textContent();
  log(specialName === "O'Brien's & Sons" ? '✅' : '❌',
    'URL-encoded special chars decode correctly', `"${specialName}"`);

  // ── 9. UX finding: enquiry success_url has no venue/booking params ─
  // The enquiry form sends: checkout.html?session_id={CHECKOUT_SESSION_ID}
  // So customers always see "our venue" with no booking ref after paying.
  await page.goto(LOCAL('?session_id=cs_test_xyz'), { waitUntil: 'domcontentloaded' });
  const defaultVenueShown = (await page.locator('#venue-name').textContent()) === 'our venue';
  const noBookingStrip    = await page.locator('#meta-strip').evaluate(el => el.classList.contains('hidden'));
  log('⚠️', 'Enquiry path: session_id only — no venue name or booking ref shown',
    `venue="${await page.locator('#venue-name').textContent()}", strip hidden=${noBookingStrip}`);

  // ── Summary ───────────────────────────────────────────────────────
  console.log('\n─── Summary ───');
  [...pass, ...warn, ...fail].forEach(l => console.log(l));
  console.log(`\n${pass.length} PASS · ${warn.length} WARN · ${fail.length} FAIL`);

  await browser.close();
  process.exit(fail.length > 0 ? 1 : 0);
})();
