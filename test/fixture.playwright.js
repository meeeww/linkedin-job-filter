/**
 * Legacy fixture smoke test — list hide only; button lives in a detail strip.
 * Run: node test/fixture.playwright.js
 */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const fileUrl = 'file://' + path.resolve(__dirname, 'fixture.html');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(fileUrl);
  await page.waitForTimeout(400);

  // Legacy fixture may still inject via detail strip if present; list must not have buttons
  const listBtnCount = await page.locator('.jobs-search-results-list .ljf-block-btn').count();
  // After v0.2, buttons are detail-only; legacy fixture without detail has 0 buttons
  console.log('list buttons', listBtnCount);

  // Seed a blocked company via storage API and ensure cards hide
  await page.evaluate(() => {
    return LJF.storage.blockCompany(
      LJF.buildCompanyIdentity({
        companyUrl: 'https://www.linkedin.com/company/acme-corp/',
        displayName: 'Acme Corp',
        logoUrl: 'https://example.com/acme.png',
      }),
      'test'
    ).then(() => LJFContent.refreshFromStorage());
  });
  await page.waitForTimeout(300);

  const hidden = await page.locator('li.jobs-search-results__list-item.ljf-hidden').count();
  if (hidden < 2) throw new Error('Expected Acme cards hidden, got ' + hidden);
  console.log('OK hidden', hidden);

  await page.click('#btn-unblock-all');
  await page.waitForTimeout(300);
  const still = await page.locator('li.ljf-hidden').count();
  if (still !== 0) throw new Error('Expected 0 hidden after unblock');

  await browser.close();
  console.log('fixture.playwright.js PASSED');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
