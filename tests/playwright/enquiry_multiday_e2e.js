const { chromium } = require('playwright');

const URL = 'https://andyjay72.github.io/VenueDesk/enquiry-form.html?t=1001';

const addDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
};

const FROM_DATE = addDays(21);  // 3 weeks out
const TO_DATE   = addDays(23);  // 3-day span
const PAST_DATE = addDays(-1);  // yesterday

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage();
  const pass = [], warn = [], fail = [];
  const log = (icon, label, detail) => {
    const line = `${icon} ${label}: ${detail}`;
    console.log(line);
    if (icon === '✅') pass.push(line);
    else if (icon === '❌') fail.push(line);
    else warn.push(line);
  };

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2500); // rooms load

  // ── Fill contact + select room/type ──────────────────────────────
  await page.fill('#name',     'Multi Day Tester');
  await page.fill('#email',    'multiday@example.com');
  await page.fill('#phone',    '07700 111222');
  await page.selectOption('#roomName',   { index: 1 });
  await page.waitForTimeout(300);
  await page.selectOption('#eventType',  { index: 1 });
  await page.fill('#numPeople', '10');

  const roomLabel = await page.locator('#roomName option:nth-child(2)').textContent();
  const rateMatch = roomLabel.match(/£?(\d+\.?\d*)/);
  const hourlyRate = rateMatch ? parseFloat(rateMatch[1]) : null;
  log('🔍', 'Room selected', `"${roomLabel.trim()}" — hourly rate: £${hourlyRate ?? '?'}`);

  // ── TEST 1: Toggle activates correctly ───────────────────────────
  const singleBefore = await page.locator('#singleDateGroup').isVisible();
  const multiBefore  = await page.locator('#multiDayFields').isVisible();
  log(singleBefore && !multiBefore ? '✅' : '❌', 'Initial state', `single visible=${singleBefore}, multi visible=${multiBefore}`);

  await page.locator('#multiDayToggle').click();
  await page.waitForTimeout(300);

  const singleAfter  = await page.locator('#singleDateGroup').isVisible();
  const multiAfter   = await page.locator('#multiDayFields').isVisible();
  const btnActive    = await page.locator('#multiDayToggle').getAttribute('data-active');
  const btnHasClass  = await page.locator('#multiDayToggle').evaluate(el => el.classList.contains('active'));
  log(!singleAfter && multiAfter && btnActive === 'true' && btnHasClass ? '✅' : '❌',
      'Toggle activates', `single hidden=${!singleAfter}, multi shown=${multiAfter}, data-active=${btnActive}, .active=${btnHasClass}`);

  // ── TEST 2: date_to < date_from → validation error ───────────────
  await page.fill('#dateFrom', TO_DATE);    // intentionally reversed
  await page.fill('#dateTo',   FROM_DATE);
  await page.selectOption('#timeFrom', '10:00');
  await page.selectOption('#timeTo',   '14:00');
  await page.waitForTimeout(800);
  const validErrClass = await page.locator('#availStatus').getAttribute('class');
  const validErrText  = await page.locator('#availText').textContent();
  log(validErrClass.includes('unavailable') ? '✅' : '❌',
      'date_to < date_from guard', `"${validErrText.trim()}"`);

  // ── TEST 3: Correct dates → availability check ───────────────────
  await page.fill('#dateFrom', FROM_DATE);
  await page.fill('#dateTo',   TO_DATE);
  await page.waitForTimeout(3500);
  const availClass = await page.locator('#availStatus').getAttribute('class');
  const availText  = await page.locator('#availText').textContent();
  if (availClass.includes('available')) {
    log('✅', 'Multi-day availability', `"${availText.trim()}"`);
  } else if (availClass.includes('unavailable')) {
    log('⚠️', 'Multi-day availability', `slot clash — "${availText.trim()}" (continuing anyway)`);
    // Try different room
    await page.selectOption('#roomName', { index: 2 });
    await page.waitForTimeout(3500);
    const ac2 = await page.locator('#availStatus').getAttribute('class');
    const at2 = await page.locator('#availText').textContent();
    log(ac2.includes('available') ? '✅' : '❌', 'Multi-day avail (room 2)', at2.trim());
  } else {
    log('❌', 'Multi-day availability', `class=${availClass}, "${availText.trim()}"`);
  }

  // ── TEST 4: Cost = hourly × hours × days ─────────────────────────
  const costVisible = await page.locator('#costEstimateRow').isVisible();
  const costTotal   = await page.locator('#costTotal').textContent();
  const costBreak   = await page.locator('#costBreakdown').textContent();
  // 10:00–14:00 = 4h, FROM→TO = 3 days
  const expectedCost = hourlyRate ? `£${(hourlyRate * 4 * 3).toFixed(2)}` : null;
  const costOk = expectedCost ? costTotal.trim() === expectedCost : costVisible;
  log(costOk ? '✅' : '❌', 'Cost calculation', `${costTotal.trim()} (expected ${expectedCost ?? '?'}) — ${costBreak.trim()}`);
  log(costBreak.includes('days') ? '✅' : '❌', 'Cost breakdown mentions days', `"${costBreak.trim()}"`);

  // ── TEST 5: Submit button state ───────────────────────────────────
  const btnDisabled = await page.locator('#submitBtn').isDisabled();
  log(!btnDisabled ? '✅' : '⚠️', 'Submit button enabled', String(!btnDisabled));

  // ── TEST 6: Submit multi-day enquiry ─────────────────────────────
  if (!btnDisabled) {
    await page.locator('#submitBtn').click();
    await page.waitForTimeout(4000);
    const successVisible = await page.locator('#successPanel').isVisible();
    const heading = await page.locator('#successPanel h2').textContent().catch(() => '');
    const formHidden = !(await page.locator('#enquiryForm').isVisible());
    log(successVisible && formHidden ? '✅' : '❌', 'Multi-day submit → success panel', `"${heading.trim()}", form hidden=${formHidden}`);

    // ── TEST 7: Reset restores clean state ──────────────────────────
    if (successVisible) {
      await page.locator('#successPanel button').click();
      await page.waitForTimeout(500);
      const formBack    = await page.locator('#enquiryForm').isVisible();
      const mdActive    = await page.locator('#multiDayToggle').getAttribute('data-active');
      const mdVisible   = await page.locator('#multiDayFields').isVisible();
      const singleBack  = await page.locator('#singleDateGroup').isVisible();
      const dateFromVal = await page.locator('#dateFrom').inputValue();
      const dateToVal   = await page.locator('#dateTo').inputValue();
      const allClear = formBack && mdActive !== 'true' && !mdVisible && singleBack && !dateFromVal && !dateToVal;
      log(allClear ? '✅' : '❌', 'Post-submit reset', `form=${formBack}, mdActive=${mdActive}, multiFields=${mdVisible}, single=${singleBack}, dateFrom="${dateFromVal}", dateTo="${dateToVal}"`);
    }
  } else {
    log('⚠️', 'Submit skipped', 'button still disabled after availability check');
  }

  // ── PROBE A: 91-day span → blocked client-side or API ────────────
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.selectOption('#roomName', { index: 1 });
  await page.waitForTimeout(200);
  await page.locator('#multiDayToggle').click();
  await page.waitForTimeout(200);
  await page.fill('#dateFrom', addDays(10));
  await page.fill('#dateTo',   addDays(101));   // 91-day span
  await page.selectOption('#timeFrom', '09:00');
  await page.selectOption('#timeTo',   '17:00');
  await page.waitForTimeout(3500);
  const span91Class = await page.locator('#availStatus').getAttribute('class');
  const span91Text  = await page.locator('#availText').textContent();
  // Client-side doesn't currently block 91 days (server does at create time)
  log('🔍', 'Probe A — 91-day span', `avail class=${span91Class.includes('available') ? 'available' : span91Class}, "${span91Text.trim()}"`);

  // ── PROBE B: Toggle off → single date fields restore ─────────────
  await page.locator('#multiDayToggle').click();
  await page.waitForTimeout(300);
  const singleRestored = await page.locator('#singleDateGroup').isVisible();
  const multiHidden    = !(await page.locator('#multiDayFields').isVisible());
  log(singleRestored && multiHidden ? '✅' : '❌', 'Probe B — toggle off restores single', `single=${singleRestored}, multi hidden=${multiHidden}`);

  // ── Summary ───────────────────────────────────────────────────────
  console.log('\n─── Summary ───');
  [...pass, ...warn, ...fail].forEach(l => console.log(l));
  console.log(`\n${pass.length} PASS · ${warn.length} WARN · ${fail.length} FAIL`);

  await browser.close();
  process.exit(fail.length > 0 ? 1 : 0);
})();
