'use strict';
const { test, expect } = require('@playwright/test');

const URL = 'https://andyjay72.github.io/VenueDesk/onboarding.html';
const KEY = 'vp-api-2026-Kj9mXqR4wZ';

test('Edit Venue — subscription_status save without 500', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  const requests500 = [];
  page.on('response', res => { if (res.status() === 500) requests500.push(res.url()); });

  // 1. Load + login
  await page.goto(URL, { waitUntil: 'networkidle' });
  await expect(page.locator('#loginOverlay')).toBeVisible();
  await page.fill('#adminKeyInput', KEY);
  await page.click('#loginBtn');
  await expect(page.locator('#loginOverlay')).toBeHidden({ timeout: 10000 });
  await page.waitForSelector('#venuesTable tr[onclick]', { timeout: 10000 });
  console.log('Login OK, venues rendered');

  // 2. Pick first non-system-admin venue (tenant_id > 1)
  const venueTenantId = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#venuesTable tr[onclick]')];
    for (const r of rows) {
      const m = r.getAttribute('onclick').match(/openVenueDetail\((\d+)\)/);
      if (m && parseInt(m[1]) > 1) return parseInt(m[1]);
    }
    return null;
  });
  console.log('Testing with tenant_id:', venueTenantId);
  expect(venueTenantId).not.toBeNull();

  // 3. Open detail panel
  await page.evaluate((tid) => openVenueDetail(tid), venueTenantId);
  await expect(page.locator('#venueDetailModal')).toHaveClass(/open/, { timeout: 5000 });
  console.log('Detail panel open');

  // 4. Click Edit Details button
  await page.locator('#venueDetailModal button', { hasText: /edit details/i }).click();
  await expect(page.locator('#editModal')).toHaveClass(/open/, { timeout: 5000 });
  console.log('Edit modal open');

  // 5. Change subscription status dropdown
  const subSel = page.locator('#editSubStatus');
  const origSub = await subSel.inputValue();
  const newSub  = origSub === 'active' ? 'trial' : 'active';
  await subSel.selectOption(newSub);
  console.log(`Sub: ${origSub} → ${newSub}`);

  // 6. Save — capture update-venue response
  const [saveResp] = await Promise.all([
    page.waitForResponse(r => r.url().includes('update-venue'), { timeout: 15000 }),
    page.locator('#editModal button', { hasText: /save changes/i }).click(),
  ]);
  const status = saveResp.status();
  const body   = await saveResp.text();
  console.log('update-venue status:', status);
  console.log('update-venue body:', body.slice(0, 200));

  // 7. No 500
  expect(status, `update-venue returned ${status}: ${body}`).not.toBe(500);
  expect(status).toBeLessThan(400);

  // 8. Toast
  const toast = page.locator('#toast');
  await expect(toast).toBeVisible({ timeout: 5000 });
  console.log('Toast:', await toast.textContent());

  // 9. No 500s session-wide
  console.log('500 responses:', requests500);
  expect(requests500).toEqual([]);

  // 10. Restore
  await page.evaluate((tid) => openVenueDetail(tid), venueTenantId);
  await expect(page.locator('#venueDetailModal')).toHaveClass(/open/, { timeout: 3000 });
  await page.locator('#venueDetailModal button', { hasText: /edit details/i }).click();
  await expect(page.locator('#editModal')).toHaveClass(/open/, { timeout: 3000 });
  await subSel.selectOption(origSub);
  await Promise.all([
    page.waitForResponse(r => r.url().includes('update-venue'), { timeout: 10000 }),
    page.locator('#editModal button', { hasText: /save changes/i }).click(),
  ]);
  console.log('Restored sub to:', origSub);

  // 11. Hard JS errors only
  const hard = consoleErrors.filter(e =>
    !e.includes('CORS') && !e.includes('favicon') &&
    !e.includes('net::ERR') && !e.includes('401') &&
    !e.includes('Failed to load resource')
  );
  if (hard.length) console.log('Hard console errors:', hard);
  expect(hard).toEqual([]);
});
