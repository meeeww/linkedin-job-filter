/**
 * Headless smoke test against test/fixture.html
 * Run: node test/fixture.playwright.js
 */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const fileUrl = 'file://' + path.resolve(__dirname, 'fixture.html');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(fileUrl);
  await page.waitForTimeout(300);

  const buttonCount = await page.locator('.ljf-block-btn').count();
  if (buttonCount < 4) {
    throw new Error('Expected >= 4 block buttons, got ' + buttonCount);
  }
  console.log('OK buttons:', buttonCount);

  // Block Acme via first button that targets Acme (first card)
  await page.locator('.ljf-block-btn').first().click();
  await page.waitForTimeout(200);

  const hiddenAcme = await page.locator('li.jobs-search-results__list-item.ljf-hidden').count();
  if (hiddenAcme < 2) {
    throw new Error('Expected >= 2 Acme cards hidden, got ' + hiddenAcme);
  }
  console.log('OK hidden after block:', hiddenAcme);

  // Simulate infinite scroll: add Acme card
  await page.click('#btn-add');
  await page.waitForTimeout(250);
  const hiddenAfterAdd = await page.locator('li.jobs-search-results__list-item.ljf-hidden').count();
  if (hiddenAfterAdd < 3) {
    throw new Error('Expected new Acme card hidden, got ' + hiddenAfterAdd);
  }
  console.log('OK hidden after scroll sim:', hiddenAfterAdd);

  // Name-only card (Gamma Soft) still visible with button
  const gammaVisible = await page.locator('text=Gamma Soft').isVisible();
  if (!gammaVisible) throw new Error('Gamma Soft should still be visible');
  console.log('OK name-only card still visible');

  // Unblock all
  await page.click('#btn-unblock-all');
  await page.waitForTimeout(250);
  const stillHidden = await page.locator('li.ljf-hidden').count();
  if (stillHidden !== 0) throw new Error('Expected 0 hidden after unblock, got ' + stillHidden);
  console.log('OK unblocked');

  if (errors.length) {
    console.error('Page errors:', errors);
    process.exit(1);
  }

  // Screenshot for walkthrough
  const out = path.resolve('/opt/cursor/artifacts/screenshots');
  require('fs').mkdirSync(out, { recursive: true });
  await page.screenshot({
    path: path.join(out, 'fixture-after-unblock.png'),
    fullPage: true,
  });

  // Re-block and screenshot hidden state
  await page.locator('.ljf-block-btn').first().click();
  await page.waitForTimeout(200);
  await page.screenshot({
    path: path.join(out, 'fixture-acme-blocked.png'),
    fullPage: true,
  });
  console.log('Screenshots saved');

  await browser.close();
  console.log('fixture.playwright.js PASSED');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
