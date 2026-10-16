/**
 * Smoke test against trimmed real /jobs/search-results/ markup.
 * Run: node test/fixture-search-results.playwright.js
 * Requires: npm install playwright (dev only)
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const fileUrl = 'file://' + path.resolve(__dirname, 'fixture-search-results.html');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => {
    if (msg.type() === 'info' || msg.type() === 'debug') {
      // eslint-disable-next-line no-console
      console.log('PAGE', msg.text());
    }
  });

  await page.goto(fileUrl);
  await page.waitForTimeout(500);

  const stats = await page.evaluate(() => {
    return window.LJFDebug ? LJFDebug.scan() : null;
  });
  console.log('stats', stats);

  if (!stats || stats.cards < 5) {
    throw new Error('Expected >= 5 cards from search-results fixture, got ' + (stats && stats.cards));
  }
  if (stats.withCompany < 5) {
    throw new Error('Expected >= 5 companies, got ' + stats.withCompany + ' samples=' + JSON.stringify(stats.samples));
  }

  const buttonCount = await page.locator('.ljf-block-btn').count();
  if (buttonCount < 5) {
    throw new Error('Expected >= 5 block buttons, got ' + buttonCount);
  }
  console.log('OK buttons', buttonCount);

  // Block first company (Hasten Group)
  await page.locator('.ljf-block-btn').first().click();
  await page.waitForTimeout(400);

  const hidden = await page.locator('.ljf-hidden').count();
  if (hidden < 1) {
    throw new Error('Expected at least 1 hidden card after block, got ' + hidden);
  }
  console.log('OK hidden', hidden);

  const storage = await page.evaluate(() => window.__LJF_MEMORY_STORAGE__.blockedCompanies);
  console.log('storage', storage);
  const keys = Object.keys(storage || {});
  if (!keys.length) throw new Error('Expected blocked company in storage');

  // Unblock
  await page.click('#btn-unblock-all');
  await page.waitForTimeout(400);
  const stillHidden = await page.locator('.ljf-hidden').count();
  if (stillHidden !== 0) throw new Error('Expected 0 hidden after unblock, got ' + stillHidden);
  console.log('OK unblocked');

  const out = path.resolve('/opt/cursor/artifacts/screenshots');
  fs.mkdirSync(out, { recursive: true });
  await page.locator('.ljf-block-btn').first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'search-results-blocked.png'), fullPage: true });

  if (errors.length) {
    console.error(errors);
    process.exit(1);
  }

  await browser.close();
  console.log('fixture-search-results.playwright.js PASSED');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
