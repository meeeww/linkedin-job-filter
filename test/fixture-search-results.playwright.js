/**
 * Smoke test: search-results lazy-column hide + detail-pane block button.
 * Run: node test/fixture-search-results.playwright.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const fileUrl = 'file://' + path.resolve(__dirname, 'fixture-search-results.html');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', (e) => {
    console.error('PAGEERROR', e);
  });

  await page.goto(fileUrl);
  await page.waitForTimeout(500);

  const stats = await page.evaluate(() => LJFDebug.scan());
  console.log('stats', JSON.stringify(stats, null, 2));

  if (!stats.listRoot || String(stats.listRoot).indexOf('SearchResultsMainContent') === -1) {
    throw new Error('Expected SearchResultsMainContent list root, got ' + stats.listRoot);
  }
  if (stats.cards < 5) throw new Error('Expected >= 5 list cards, got ' + stats.cards);
  if (stats.withCompany < 5) throw new Error('Expected companies on list cards');

  // No buttons inside lazy-column
  const listBtns = await page.locator('[data-testid="lazy-column"][componentkey="SearchResultsMainContent"] .ljf-block-btn').count();
  if (listBtns !== 0) throw new Error('Expected 0 buttons in lazy-column, got ' + listBtns);

  // Button only in detail pane
  const detailBtns = await page.locator('[data-sdui-screen*="SemanticJobDetails"] .ljf-block-btn').count();
  if (detailBtns !== 1) throw new Error('Expected 1 detail button, got ' + detailBtns);
  console.log('OK button placement');

  // Block from detail
  await page.locator('[data-sdui-screen*="SemanticJobDetails"] .ljf-block-btn').click();
  await page.waitForTimeout(400);

  const after = await page.evaluate(() => ({
    hidden: document.querySelectorAll('[data-testid="lazy-column"] .ljf-hidden').length,
    storage: window.__LJF_MEMORY_STORAGE__.blockedCompanies,
    listBtns: document.querySelectorAll('[componentkey="SearchResultsMainContent"] .ljf-block-btn').length,
    stats: LJFDebug.scan(),
  }));
  console.log('after block', after);

  if (after.hidden < 1) throw new Error('Expected Hasten Group card hidden in lazy-column');
  const entry = Object.values(after.storage)[0];
  if (!entry || !/hasten/i.test(entry.displayName)) throw new Error('Expected Hasten in storage');
  if (!entry.companyUrl || entry.companyUrl.indexOf('/company/hasten-group') === -1) {
    throw new Error('Expected companyUrl stored from detail, got ' + entry.companyUrl);
  }
  if (!entry.logoUrl) throw new Error('Expected logoUrl stored from detail');
  console.log('OK hide + rich storage');

  // Simulate scroll: append another Hasten card into lazy-column
  await page.evaluate(() => {
    const list = document.querySelector('[componentkey="SearchResultsMainContent"]');
    const card = document.createElement('div');
    card.setAttribute('role', 'button');
    card.setAttribute('componentkey', 'job-card-component-ref-9999999999');
    card.innerHTML =
      '<p>Otro rol Hasten</p><p>Hasten Group</p><p>España (En remoto)</p>';
    list.appendChild(card);
  });
  await page.waitForTimeout(400);
  const hiddenAfterScroll = await page.locator('[componentkey="job-card-component-ref-9999999999"].ljf-hidden').count();
  if (hiddenAfterScroll !== 1) {
    throw new Error('Expected scroll-added Hasten card to be hidden');
  }
  console.log('OK scroll hide');

  await page.click('#btn-unblock-all');
  await page.waitForTimeout(400);
  const still = await page.locator('[data-testid="lazy-column"] .ljf-hidden').count();
  if (still !== 0) throw new Error('Expected 0 hidden after unblock');

  const out = path.resolve('/opt/cursor/artifacts/screenshots');
  fs.mkdirSync(out, { recursive: true });
  await page.screenshot({ path: path.join(out, 'detail-button-and-list.png'), fullPage: true });

  await browser.close();
  console.log('fixture-search-results.playwright.js PASSED');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
