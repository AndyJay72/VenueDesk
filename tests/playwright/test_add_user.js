const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx  = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // Capture all network responses to/from onboarding endpoints
  const calls = [];
  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('onboarding') || url.includes('create-venue') || url.includes('reset-password')) {
      try {
        const body = await resp.text();
        calls.push({ url: url.split('?')[0], status: resp.status(), body: body.slice(0, 300) });
      } catch(e) {}
    }
  });

  // Log in to onboarding
  await page.goto('https://venuedesk.co.uk/onboarding.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Enter admin key
  const keyInput = page.locator('#adminKeyInput, input[type="password"], input[placeholder*="key" i], input[placeholder*="admin" i]').first();
  await keyInput.fill('vp-api-2026-Kj9mXqR4wZ');
  await page.locator('button:has-text("Login"), button:has-text("Enter"), button[type="submit"]').first().click();
  await page.waitForTimeout(3000);

  console.log('Current URL:', page.url());

  // Take a screenshot to see the venues list
  await page.screenshot({ path: '/tmp/onboarding_venues.png' });

  // Find a venue with no user (Community Centre B - tenant 1002) and click Set Login
  // Look for button near "Community Centre B" or any "Set Login" button
  const setLoginBtns = await page.locator('button:has-text("Set Login"), button[title*="Set login" i], button[title*="login" i]').all();
  console.log(`Found ${setLoginBtns.length} Set Login buttons`);

  if (setLoginBtns.length > 0) {
    await setLoginBtns[0].click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: '/tmp/onboarding_set_login_modal.png' });

    // Fill in the form
    const usernameInput = page.locator('#newPwUsernameInput');
    const passwordInput = page.locator('#newPwInput');
    if (await usernameInput.isVisible()) {
      await usernameInput.fill('teststaff01');
      await passwordInput.fill('TestPass123');
      console.log('Filled in username: teststaff01, password: TestPass123');

      // Click confirm
      const confirmBtn = page.locator('#pwModalConfirmBtn, button:has-text("Set Login")').first();
      await confirmBtn.click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: '/tmp/onboarding_after_add.png' });
    } else {
      console.log('Username input not visible — modal may not have opened');
    }
  }

  // Print all captured API calls
  console.log('\n=== API Calls ===');
  calls.forEach(c => console.log(`${c.status} ${c.url}\n  ${c.body}\n`));

  await browser.close();
})();
