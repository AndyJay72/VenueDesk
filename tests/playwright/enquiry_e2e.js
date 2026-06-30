const { chromium } = require('playwright');

const URL = 'https://andyjay72.github.io/VenueDesk/enquiry-form.html?t=1001';

// Pick a future date
const d = new Date();
d.setDate(d.getDate() + 14);
const FUTURE_DATE = d.toISOString().split('T')[0];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];
  const log = (icon, label, detail) => { results.push(`${icon} ${label}: ${detail}`); console.log(`${icon} ${label}: ${detail}`); };

  // ── 1. Load page ──────────────────────────────────────────────────
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // ── Fix 1: venue badge + page title ───────────────────────────────
  const badge = await page.locator('#venueBadge').isVisible();
  const venueName = await page.locator('#venueNameDisplay').textContent().catch(() => '');
  const pageTitle = await page.title();
  if (badge && venueName.trim()) {
    log('✅', 'Fix 1 — Venue badge', `"${venueName.trim()}"`);
  } else {
    log('❌', 'Fix 1 — Venue badge', `badge visible=${badge}, name="${venueName}"`);
  }
  if (pageTitle.includes(venueName.trim())) {
    log('✅', 'Fix 1 — Page title', pageTitle);
  } else {
    log('❌', 'Fix 1 — Page title', `"${pageTitle}" (expected venue name)`);
  }

  // ── 2. Rooms + event types load ───────────────────────────────────
  await page.waitForTimeout(2500); // let n8n respond
  const roomOpts = await page.locator('#roomName option:not([disabled])').count();
  const typeOpts = await page.locator('#eventType option:not([disabled])').count();
  log(roomOpts > 0 ? '✅' : '❌', 'Rooms loaded', `${roomOpts} options`);
  log(typeOpts > 0 ? '✅' : '❌', 'Event types loaded', `${typeOpts} options`);

  // ── Fix 5: deposit note copy ──────────────────────────────────────
  const depositNoteText = await page.locator('#depositNote').textContent().catch(() => '');
  if (depositNoteText.includes('pending staff confirmation')) {
    log('✅', 'Fix 5 — Deposit note', 'reads "pending staff confirmation"');
  } else {
    log('❌', 'Fix 5 — Deposit note', `got: "${depositNoteText.trim()}"`);
  }

  // ── 3. Fill contact details ───────────────────────────────────────
  await page.fill('#name', 'Test Customer');
  await page.fill('#email', 'test@example.com');
  await page.fill('#phone', '07700 900000');
  log('✅', 'Contact details', 'filled');

  // ── 4. Select room, type, date, times ────────────────────────────
  await page.selectOption('#roomName', { index: 1 });
  await page.waitForTimeout(300);
  await page.selectOption('#eventType', { index: 1 });
  await page.fill('#eventDate', FUTURE_DATE);
  await page.selectOption('#timeFrom', '10:00');
  await page.selectOption('#timeTo', '12:00');
  await page.fill('#numPeople', '5');
  log('✅', 'Event details', `room[1], date=${FUTURE_DATE}, 10:00–12:00, 5 guests`);

  // ── 5. Availability check ─────────────────────────────────────────
  await page.waitForTimeout(3000); // debounce + API call
  const availClass = await page.locator('#availStatus').getAttribute('class');
  const availText  = await page.locator('#availText').textContent();
  if (availClass && availClass.includes('available')) {
    log('✅', 'Availability', `"${availText.trim()}"`);
  } else if (availClass && availClass.includes('unavailable')) {
    log('⚠️', 'Availability', `slot taken — "${availText.trim()}" (trying another room)`);
    // Try next room
    await page.selectOption('#roomName', { index: 2 });
    await page.waitForTimeout(3000);
    const ac2 = await page.locator('#availStatus').getAttribute('class');
    const at2  = await page.locator('#availText').textContent();
    log(ac2.includes('available') ? '✅' : '❌', 'Availability (room 2)', at2.trim());
  } else {
    log('❌', 'Availability', `class="${availClass}", text="${availText}"`);
  }

  // ── 6. Cost estimate ──────────────────────────────────────────────
  const costVisible = await page.locator('#costEstimateRow').isVisible();
  const costTotal   = await page.locator('#costTotal').textContent().catch(() => '');
  const costBreak   = await page.locator('#costBreakdown').textContent().catch(() => '');
  log(costVisible ? '✅' : '❌', 'Cost estimate', `${costTotal.trim()} — ${costBreak.trim()}`);

  // ── 7. Submit button enabled ──────────────────────────────────────
  const btnDisabled = await page.locator('#submitBtn').isDisabled();
  const btnText     = await page.locator('#submitBtn span').textContent().catch(() => '');
  log(!btnDisabled ? '✅' : '❌', 'Submit button', `enabled=${!btnDisabled}, label="${btnText.trim()}"`);

  // ── Fix 3: capacity exceeded → toast not alert ────────────────────
  // Temporarily set guest count over capacity to test toast path
  const capRoom = await page.locator('#roomName option:nth-child(2)').getAttribute('value') || '';
  const capText = await page.locator('#roomName option:nth-child(2)').textContent() || '';
  const capMatch = capText.match(/Cap:\s*(\d+)/);
  if (capMatch) {
    const cap = parseInt(capMatch[1]);
    await page.fill('#numPeople', String(cap + 1));
    await page.waitForTimeout(500);
    let alertFired = false;
    page.on('dialog', async dlg => { alertFired = true; await dlg.dismiss(); });
    await page.locator('#submitBtn').click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(800);
    const toastEl = await page.locator('.toast.error').count();
    if (toastEl > 0 && !alertFired) {
      log('✅', 'Fix 3 — Capacity toast', `alert()=false, toast shown (cap=${cap})`);
    } else if (alertFired) {
      log('❌', 'Fix 3 — Capacity toast', 'alert() still firing');
    } else {
      log('⚠️', 'Fix 3 — Capacity toast', 'button disabled before click (availability may have reset)');
    }
    // Restore valid guest count
    await page.fill('#numPeople', '5');
    await page.waitForTimeout(2500);
  } else {
    log('🔍', 'Fix 3 — Capacity toast', 'room has no capacity set — skipped');
  }

  // Re-check submit enabled after restoring guest count
  await page.waitForTimeout(500);

  // ── 8. Submit enquiry → success panel ────────────────────────────
  const submitEnabled = !(await page.locator('#submitBtn').isDisabled());
  if (!submitEnabled) {
    // Re-trigger availability
    await page.selectOption('#timeFrom', '09:00');
    await page.waitForTimeout(200);
    await page.selectOption('#timeFrom', '10:00');
    await page.waitForTimeout(3000);
  }

  await page.locator('#submitBtn').click({ timeout: 5000 }).catch(e => log('❌', 'Submit click', e.message));
  await page.waitForTimeout(4000); // API call

  const successVisible = await page.locator('#successPanel').isVisible();
  const formHidden     = !(await page.locator('#enquiryForm').isVisible());
  const successHeading = await page.locator('#successPanel h2').textContent().catch(() => '');
  const has7day        = await page.locator('#successPanel').textContent().then(t => t.includes('7 days'));
  if (successVisible && formHidden) {
    log('✅', 'Fix 4 — Success panel', `"${successHeading.trim()}", 7-day copy=${has7day}`);
  } else {
    log('❌', 'Fix 4 — Success panel', `visible=${successVisible}, form hidden=${formHidden}`);
    const availT = await page.locator('#availText').textContent().catch(() => '');
    log('🔍', 'Submit state', `availStatus="${availT}"`);
  }

  // ── 9. "Submit Another Enquiry" resets form ───────────────────────
  if (successVisible) {
    await page.locator('#successPanel button').click();
    await page.waitForTimeout(500);
    const formBack    = await page.locator('#enquiryForm').isVisible();
    const successGone = !(await page.locator('#successPanel').isVisible());
    const mdActive    = await page.locator('#multiDayToggle').getAttribute('data-active');
    const mdVisible   = await page.locator('#multiDayFields').isVisible();
    if (formBack && successGone && mdActive !== 'true' && !mdVisible) {
      log('✅', 'Fix 2 — Reset form', 'form restored, multi-day toggle cleared');
    } else {
      log('❌', 'Fix 2 — Reset form', `form=${formBack}, successGone=${successGone}, mdActive=${mdActive}, mdVisible=${mdVisible}`);
    }
  } else {
    log('⚠️', 'Fix 2 — Reset form', 'skipped — success panel never showed');
  }

  // ── Print summary ─────────────────────────────────────────────────
  console.log('\n─── Summary ───');
  results.forEach(r => console.log(r));

  await browser.close();
})();
