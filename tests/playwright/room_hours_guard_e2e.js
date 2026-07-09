const { chromium } = require('playwright');

// Local files — no CDN wait needed
const EF_LOCAL = 'file:///Users/andrewjohnson/Downloads/venue_desk_backup/enquiry-form.html?t=1001';
const MB_LOCAL = 'file:///Users/andrewjohnson/Downloads/venue_desk_backup/manual-booking.html';

// Room with restricted hours injected via API mock
const MOCK_ROOM = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  name: 'Test Hall', capacity: 100, day_rate: '50.00',
  is_active: true, open_time: '09:00:00', close_time: '21:00:00',
  parent_room_id: null, partition_order: null, partition_total: null
};
const MOCK_TYPE = { name: 'Conference', is_active: true };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const pass = [], fail = [];
  const log = (icon, label, detail='') => {
    const line = `${icon} ${label}${detail ? ': '+detail : ''}`;
    console.log(line);
    if (icon === '✅') pass.push(line); else fail.push(line);
  };

  // ═══════════════════════════════════════════════════════════════════
  // SUITE A — enquiry-form.html
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Suite A: enquiry-form.html ──');

  {
    const page = await browser.newPage();
    let apiCallMade = false;

    // Mock rooms/types to inject a room with hours
    await page.route('**/get-rooms**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: [MOCK_ROOM] })
    }));
    await page.route('**/get-event-types**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: [MOCK_TYPE] })
    }));
    await page.route('**/blocked-dates**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: [] })
    }));
    await page.route('**/stripe/config**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { is_stripe_enabled: false, venue_name: 'Test Venue' } })
    }));
    // Track if check-availability API is called
    await page.route('**/check-availability**', route => {
      apiCallMade = true;
      route.continue();
    });

    await page.goto(EF_LOCAL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // A1 — Rooms loaded with mocked data
    const roomOpts = await page.locator('#roomName option:not([disabled])').count();
    log(roomOpts === 1 ? '✅' : '❌', 'A1 — Mock room loaded', `${roomOpts} option(s)`);

    // A2 — Select the room — hint should appear
    await page.selectOption('#roomName', { label: 'Test Hall (Cap: 100)' });
    await page.waitForTimeout(300);
    const hintVisible = await page.locator('#roomHoursHintRow').isVisible();
    const hintText    = await page.locator('#roomHoursHintText').textContent();
    log(hintVisible && hintText.includes('09:00') && hintText.includes('21:00') ? '✅' : '❌',
      'A2 — Room hours hint shown', `"${hintText}"`);

    // Fill required fields so guards can run
    await page.fill('#name', 'Test'); await page.fill('#email', 'a@b.com'); await page.fill('#phone', '0700');
    await page.fill('#numPeople', '10');
    await page.selectOption('#eventType', { label: 'Conference' });
    const futureDate = (() => { const d = new Date(); d.setDate(d.getDate()+14); return d.toISOString().split('T')[0]; })();
    await page.fill('#eventDate', futureDate);

    // A3 — Start time BEFORE open_time → error without API call
    apiCallMade = false;
    await page.selectOption('#timeFrom', '08:00');
    await page.selectOption('#timeTo',   '12:00');
    await page.waitForTimeout(700);
    const a3Class = await page.locator('#availStatus').getAttribute('class');
    const a3Text  = await page.locator('#availText').textContent();
    log(a3Class.includes('unavailable') && !apiCallMade ? '✅' : '❌',
      "A3 — Start before open → error, no API call", `"${a3Text.trim()}"`);
    log(a3Text.includes("09:00") ? '✅' : '❌', 'A3b — Error message mentions opening time', a3Text.trim());

    // A4 — End time AFTER close_time → error without API call
    apiCallMade = false;
    await page.selectOption('#timeFrom', '10:00');
    await page.selectOption('#timeTo',   '22:00');
    await page.waitForTimeout(700);
    const a4Class = await page.locator('#availStatus').getAttribute('class');
    const a4Text  = await page.locator('#availText').textContent();
    log(a4Class.includes('unavailable') && !apiCallMade ? '✅' : '❌',
      'A4 — End after close → error, no API call', `"${a4Text.trim()}"`);
    log(a4Text.includes("21:00") ? '✅' : '❌', 'A4b — Error message mentions closing time', a4Text.trim());

    // A5 — Valid times → API call IS made
    apiCallMade = false;
    await page.route('**/check-availability**', async route => {
      apiCallMade = true;
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ available: true }) });
    });
    await page.selectOption('#timeFrom', '10:00');
    await page.selectOption('#timeTo',   '14:00');
    await page.waitForTimeout(700);
    const a5Class = await page.locator('#availStatus').getAttribute('class');
    log(apiCallMade ? '✅' : '❌', 'A5 — Valid times → API call IS made', `avail class=${a5Class.includes('available') ? 'available' : a5Class}`);

    // A6 — Room with NO hours → hint hidden
    await page.route('**/get-rooms**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: [{ ...MOCK_ROOM, name: 'Open Room', open_time: null, close_time: null }] })
    }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.selectOption('#roomName', { index: 1 });
    await page.waitForTimeout(300);
    const a6HintVisible = await page.locator('#roomHoursHintRow').isVisible();
    log(!a6HintVisible ? '✅' : '❌', 'A6 — Room with no hours → hint hidden');

    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════════
  // SUITE B — manual-booking.html
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── Suite B: manual-booking.html ──');

  {
    const page = await browser.newPage();
    let apiCallMade = false;

    // Manual-booking uses n8n webhooks for rooms/pricing/types
    await page.route('**/get-rooms**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: [MOCK_ROOM] })
    }));
    await page.route('**/get-pricing**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: [] })
    }));
    await page.route('**/get-event-types**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: [MOCK_TYPE] })
    }));
    await page.route('**/blocked-dates**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: [] })
    }));
    await page.route('**/check-availability**', route => {
      apiCallMade = true;
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ available: true }) });
    });
    // Suppress auth redirect
    await page.addInitScript(() => {
      sessionStorage.setItem('vp_token', 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6InRlc3QiLCJ1c2VyX2lkIjoidGVzdCIsInRlbmFudF9pZCI6MTAwMSwicm9sZSI6ImFkbWluIiwiZnVsbF9uYW1lIjoiVGVzdCJ9.fake');
      sessionStorage.setItem('vp_tenant_id', '1001');
      sessionStorage.setItem('vp_user_name', 'Test');
    });

    await page.goto(MB_LOCAL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // B1 — Room loads in dropdown
    const roomOpts = await page.locator('#roomSelect option:not([disabled])').count();
    log(roomOpts >= 1 ? '✅' : '❌', 'B1 — Mock room loaded in manual-booking', `${roomOpts} option(s)`);

    // B2 — Select room → hint appears (use index 1 — index 0 is the disabled placeholder)
    await page.selectOption('#roomSelect', { index: 1 });
    await page.waitForTimeout(300);
    const b2Visible = await page.locator('#mbRoomHoursHintRow').isVisible();
    const b2Text    = await page.locator('#mbRoomHoursHintText').textContent();
    log(b2Visible && b2Text.includes('09:00') && b2Text.includes('21:00') ? '✅' : '❌',
      'B2 — Room hours hint shown', `"${b2Text}"`);

    // Select date and set start/end times
    const futureDate = (() => { const d = new Date(); d.setDate(d.getDate()+14); return d.toISOString().split('T')[0]; })();
    await page.fill('#eventDate', futureDate);

    // B3 — Start before open → error, no API call
    apiCallMade = false;
    await page.selectOption('#startTime', '08:00');
    await page.selectOption('#endTime',   '12:00');
    await page.waitForTimeout(700);
    const b3Class = await page.locator('#availStatus').getAttribute('class');
    const b3Text  = await page.locator('#availText').textContent();
    log(b3Class.includes('unavailable') && !apiCallMade ? '✅' : '❌',
      'B3 — Start before open → error, no API call', `"${b3Text.trim()}"`);
    log(b3Text.includes("09:00") ? '✅' : '❌', 'B3b — Error mentions opening time', b3Text.trim());

    // B4 — End after close → error, no API call
    apiCallMade = false;
    await page.selectOption('#startTime', '10:00');
    await page.selectOption('#endTime',   '22:00');
    await page.waitForTimeout(700);
    const b4Class = await page.locator('#availStatus').getAttribute('class');
    const b4Text  = await page.locator('#availText').textContent();
    log(b4Class.includes('unavailable') && !apiCallMade ? '✅' : '❌',
      'B4 — End after close → error, no API call', `"${b4Text.trim()}"`);
    log(b4Text.includes("21:00") ? '✅' : '❌', 'B4b — Error mentions closing time', b4Text.trim());

    // B5 — End before start → error (new guard)
    apiCallMade = false;
    await page.selectOption('#startTime', '14:00');
    await page.selectOption('#endTime',   '12:00');
    await page.waitForTimeout(700);
    const b5Class = await page.locator('#availStatus').getAttribute('class');
    const b5Text  = await page.locator('#availText').textContent();
    log(b5Class.includes('unavailable') && !apiCallMade ? '✅' : '❌',
      'B5 — End before start → error, no API call', `"${b5Text.trim()}"`);

    // B6 — Valid times → API call IS made
    apiCallMade = false;
    await page.selectOption('#startTime', '10:00');
    await page.selectOption('#endTime',   '16:00');
    await page.waitForTimeout(700);
    log(apiCallMade ? '✅' : '❌', 'B6 — Valid times → API call made');

    await page.close();
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log('\n─── Summary ───');
  [...pass, ...fail].forEach(l => console.log(l));
  console.log(`\n${pass.length} PASS · ${fail.length} FAIL`);

  await browser.close();
  process.exit(fail.length > 0 ? 1 : 0);
})();
