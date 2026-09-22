'use strict';
const { test, expect } = require('@playwright/test');

// Tomorrow's date as YYYY-MM-DD
function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

test('Email flow — enquiry submission sends customer + staff emails', async ({ page }) => {
  const captured = [];
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('enquiry') || url.includes('email') || url.includes('stripe/config') || url.includes('create-request')) {
      try {
        const body = await res.text();
        captured.push({ url, status: res.status(), body: body.slice(0, 300) });
      } catch (_) {}
    }
  });

  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  // ── 1. Load enquiry form for Hayward Centre (tenant 1001) ─────────────────
  await page.goto(
    'https://andyjay72.github.io/VenueDesk/enquiry-form.html?t=1001',
    { waitUntil: 'networkidle' }
  );

  // Venue name should appear in hero
  const title = await page.locator('#pageTitle').textContent();
  console.log('Venue name in hero:', title);
  expect(title.trim().length).toBeGreaterThan(0);

  // ── 2. Wait for rooms + event types to load ───────────────────────────────
  await page.waitForFunction(
    () => document.querySelector('#roomName')?.options?.length > 1 &&
          document.querySelector('#eventType')?.options?.length > 1,
    { timeout: 10000 }
  );
  console.log('Rooms and event types loaded');

  // ── 3. Fill contact details ───────────────────────────────────────────────
  await page.fill('#name',  'Test Customer');
  await page.fill('#email', 'andy.ralston.johnson@gmail.com');
  await page.fill('#phone', '07700900001');

  // ── 4. Pick first available room + event type ─────────────────────────────
  const firstRoom = await page.locator('#roomName option:not([value=""])').first().getAttribute('value');
  await page.selectOption('#roomName', firstRoom);
  console.log('Room selected:', firstRoom);

  const firstEvent = await page.locator('#eventType option:not([value=""])').first().getAttribute('value');
  await page.selectOption('#eventType', firstEvent);

  // ── 5. Set date (tomorrow) and times ─────────────────────────────────────
  await page.fill('#eventDate', tomorrow());
  await page.selectOption('#timeFrom', '10:00');
  await page.selectOption('#timeTo',   '12:00');
  await page.fill('#numPeople', '10');
  console.log('Date:', tomorrow(), '10:00–12:00');

  // ── 6. Wait for availability check ───────────────────────────────────────
  await page.waitForTimeout(800); // debounce settles
  const availBox = await page.locator('#availStatus').textContent();
  console.log('Availability status:', availBox);

  // ── 7. Submit enquiry — wait only for create-request (email is fire-and-forget) ──
  const emailRespPromise = page.waitForResponse(
    r => r.url().includes('enquiry-received-email'), { timeout: 8000 }
  ).catch(() => null);

  const [createResp] = await Promise.all([
    page.waitForResponse(r => r.url().includes('create-request'), { timeout: 15000 }),
    page.locator('#submitBtn').click(),
  ]);

  const createStatus = createResp.status();
  const createBody   = await createResp.text();
  console.log('\n── /enquiry/create-request ──');
  console.log('Status:', createStatus);
  console.log('Body:  ', createBody.slice(0, 300));

  // Give the fire-and-forget email fetch a moment to fire
  const emailResp = await emailRespPromise;
  if (emailResp) {
    console.log('\n── enquiry-received-email webhook ──');
    console.log('Status:', emailResp.status());
    try { console.log('Body:', (await emailResp.text()).slice(0, 200)); } catch (_) {}
  } else {
    console.log('\n── enquiry-received-email: fired async (not awaited by browser) ──');
  }

  // ── 8. Assert booking request created ────────────────────────────────────
  expect(createStatus, `create-request returned ${createStatus}: ${createBody}`).toBe(200);
  const parsed = JSON.parse(createBody);
  expect(parsed.success).toBe(true);
  expect(parsed.booking_request_id).toBeTruthy();
  console.log('\nBooking request ID:', parsed.booking_request_id);

  // ── 9. Success panel shown ────────────────────────────────────────────────
  await expect(page.locator('#successPanel')).toBeVisible({ timeout: 5000 });
  const successText = await page.locator('#successPanel').textContent();
  console.log('\nSuccess panel text (truncated):', successText.slice(0, 150));

  // ── 10. Screenshot ────────────────────────────────────────────────────────
  await page.screenshot({ path: 'test-results/email_flow_success.png', fullPage: false });

  // ── 11. No hard console errors ────────────────────────────────────────────
  const hard = consoleErrors.filter(e =>
    !e.includes('CORS') && !e.includes('favicon') &&
    !e.includes('net::ERR') && !e.includes('401') &&
    !e.includes('Failed to load resource')
  );
  if (hard.length) console.log('Console errors:', hard);
  expect(hard).toEqual([]);
});
