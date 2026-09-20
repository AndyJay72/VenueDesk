/**
 * calendar_dateclick.spec.js
 *
 * Verifies the dateClick routing fix:
 *   - Clicking the date background ALWAYS opens the QB modal (#qbModal)
 *   - Clicking an event chip opens the booking details modal (#eventModal)
 *
 * All network calls mocked. Runs fully offline.
 */

const { test, expect } = require('@playwright/test');

// ── Fake JWT (passes Rule F4 claim validation) ────────────────────────────────
const _payload = JSON.stringify({
  id: 'test-uid', user_id: 'test-uid', username: 'teststaff',
  role: 'admin', full_name: 'Test Staff', name: 'Test Staff',
  tenant_id: 1001, exp: 9999999999,
});
const FAKE_JWT = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${
  Buffer.from(_payload).toString('base64').replace(/=/g,'')
}.FAKESIG`;

// Future date guaranteed to be in the month FullCalendar defaults to on load.
// Use the 15th of next month so it's always visible and never in the past.
function futureDate() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  d.setDate(15);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

const TARGET_DATE = futureDate();

// Mock booking on TARGET_DATE — gives the calendar an event chip to click.
const MOCK_BOOKING = {
  id: 'booking-test-001',
  booking_id: 'booking-test-001',
  title: 'Jane Smith',
  customer_name: 'Jane Smith',
  customer_email: 'jane@example.com',
  customer_phone: '07700000000',
  room_name: 'Main Hall',
  start: `${TARGET_DATE}T10:00:00`,
  end:   `${TARGET_DATE}T12:00:00`,
  booking_date: TARGET_DATE,
  date_from: TARGET_DATE,
  date_to: TARGET_DATE,
  start_time: '10:00',
  end_time: '12:00',
  status: 'confirmed',
  balance_due: '0',
  total_amount: '80',
  dateLabel: TARGET_DATE,
  time: '10:00 – 12:00',
  extendedProps: {
    booking_id: 'booking-test-001',
    customer_name: 'Jane Smith',
    customer_email: 'jane@example.com',
    customer_phone: '07700000000',
    room_name: 'Main Hall',
    status: 'confirmed',
    balance_due: '0',
    total_amount: '80',
    dateLabel: TARGET_DATE,
    time: '10:00 – 12:00',
  },
};

const MOCK_ROOMS = [
  { id: 'room-aaa', name: 'Main Hall', day_rate: '80.00', capacity: 100, is_active: true,
    open_time: null, close_time: null },
];
const MOCK_TYPES  = [{ id: 'et-1', name: 'General Hire', is_active: true }];

async function setupCalendarPage(page) {
  await page.addInitScript(({ jwt }) => {
    sessionStorage.setItem('vp_token',     jwt);
    sessionStorage.setItem('vp_tenant_id', '1001');
    sessionStorage.setItem('vp_user_name', 'Test Staff');
    sessionStorage.setItem('vp_user', JSON.stringify({
      id: 'test-uid', user_id: 'test-uid', full_name: 'Test Staff',
      role: 'admin', tenant_id: 1001,
    }));
  }, { jwt: FAKE_JWT });

  // Catch-all first (LIFO — registered last wins, so specific routes below win)
  await page.route('**/api.venuedesk.co.uk/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }) }));

  await page.route('**/n8n.srv1090894.hstgr.cloud/webhook/**', route => {
    const url = route.request().url();
    if (url.includes('get-rooms'))
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_ROOMS }) });
    if (url.includes('get-event-types'))
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_TYPES }) });
    if (url.includes('get-pricing'))
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: [] }) });
    if (url.includes('blocked-dates'))
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: [] }) });
    // all-bookings — return one confirmed booking on TARGET_DATE
    if (url.includes('all-bookings') || url.includes('get-bookings'))
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: [MOCK_BOOKING] }) });
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }) });
  });

  await page.goto('http://localhost:7171/calendar.html');
  // Wait for FullCalendar to render its grid
  await page.waitForSelector('.fc-daygrid-day', { timeout: 10000 });
}

// Navigate to TARGET_DATE's month if needed
async function navigateToTargetMonth(page) {
  const target = new Date(TARGET_DATE + 'T12:00:00');
  const targetLabel = target.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  for (let i = 0; i < 3; i++) {
    const titleEl = page.locator('.fc-toolbar-title');
    const title = await titleEl.textContent();
    if (title && title.includes(targetLabel.split(' ')[0])) break;
    await page.locator('.fc-next-button').click();
    await page.waitForTimeout(300);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('calendar.html — dateClick routing fix', () => {

  test('1. Clicking date background on a day WITH bookings opens QB modal (not event modal)', async ({ page }) => {
    await setupCalendarPage(page);
    await navigateToTargetMonth(page);

    // Wait for the event chip to appear (confirms mock booking rendered)
    await page.waitForSelector('.fc-daygrid-event', { timeout: 8000 });

    // Click the day cell background — NOT the event chip.
    // Target the day-frame background (the empty area of the cell).
    const dayCell = page.locator(`.fc-daygrid-day[data-date="${TARGET_DATE}"]`);
    await expect(dayCell).toBeVisible();

    // Click the day number / top area (empty background, not the event strip)
    const dayTop = dayCell.locator('.fc-daygrid-day-top');
    await dayTop.click();
    await page.waitForTimeout(400);

    // QB modal should be open; event modal should stay closed
    await expect(page.locator('#qbModal')).toHaveClass(/open/);
    await expect(page.locator('#eventModal')).not.toHaveClass(/open/);

    // QB modal should have TARGET_DATE pre-filled
    const dateVal = await page.locator('#qb-eventDate').inputValue();
    expect(dateVal).toBe(TARGET_DATE);
  });

  test('2. Clicking date background on an EMPTY day opens QB modal', async ({ page }) => {
    await setupCalendarPage(page);
    await navigateToTargetMonth(page);

    // Pick the 20th — no mock booking there
    const emptyDate = TARGET_DATE.slice(0, 8) + '20';
    const dayCell = page.locator(`.fc-daygrid-day[data-date="${emptyDate}"]`);
    await expect(dayCell).toBeVisible();

    await dayCell.locator('.fc-daygrid-day-top').click();
    await page.waitForTimeout(400);

    await expect(page.locator('#qbModal')).toHaveClass(/open/);
    await expect(page.locator('#eventModal')).not.toHaveClass(/open/);
  });

  test('3. Clicking an event chip opens the booking details modal (eventClick intact)', async ({ page }) => {
    await setupCalendarPage(page);
    await navigateToTargetMonth(page);

    // Wait for the event chip
    await page.waitForSelector('.fc-daygrid-event', { timeout: 8000 });

    // Click the event chip itself
    const chip = page.locator('.fc-daygrid-event').first();
    await chip.click();
    await page.waitForTimeout(400);

    // Event modal should open; QB modal should stay closed
    await expect(page.locator('#eventModal')).toHaveClass(/open/);
    await expect(page.locator('#qbModal')).not.toHaveClass(/open/);

    // Event modal should show the customer name from mock data
    const titleText = await page.locator('#e-title').textContent();
    expect(titleText).toContain('Jane Smith');
  });

  test('4. [probe] Clicking a past date does nothing — no modal opens', async ({ page }) => {
    await setupCalendarPage(page);

    // Navigate back to previous month to find a past date
    await page.locator('.fc-prev-button').click();
    await page.waitForTimeout(300);

    // Find any rendered past-day cell
    const pastDay = page.locator('.fc-daygrid-day.fc-day-past').first();
    const pastDate = await pastDay.getAttribute('data-date');
    if (!pastDate) return; // no past days visible — skip

    await pastDay.locator('.fc-daygrid-day-top').click();
    await page.waitForTimeout(400);

    await expect(page.locator('#qbModal')).not.toHaveClass(/open/);
    await expect(page.locator('#eventModal')).not.toHaveClass(/open/);
  });

});
