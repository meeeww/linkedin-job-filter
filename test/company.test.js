/**
 * Lightweight Node checks for company key normalization (no Chrome APIs).
 * Run: node test/company.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { console, URL };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const companySrc = fs.readFileSync(path.join(__dirname, '../lib/company.js'), 'utf8');
vm.runInContext(companySrc, sandbox);

const LJF = sandbox.LJF;
let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log('  OK  ', msg);
  } else {
    failed += 1;
    console.error('  FAIL', msg);
  }
}

console.log('company.js');

assert(LJF.normalizeName('  Acme  Corp! ') === 'acme corp', 'normalizeName collapses spaces/punct');
assert(LJF.normalizeName('Café & Co') === 'cafe and co', 'normalizeName strips accents and &');

const byId = LJF.parseCompanyHref('https://www.linkedin.com/company/12345678/?trk=foo');
assert(byId.companyId === '12345678', 'parseCompanyHref extracts numeric id');
assert(byId.pathname === '/company/12345678/', 'parseCompanyHref normalizes pathname');

const bySlug = LJF.parseCompanyHref('/company/Acme-Corp/');
assert(bySlug.companyId === null, 'slug has no numeric id');
assert(bySlug.pathname === '/company/acme-corp/', 'slug pathname lowercased');

const idKey = LJF.buildCompanyIdentity({
  companyId: '99',
  companyUrl: 'https://www.linkedin.com/company/99/',
  displayName: 'Nueve',
});
assert(idKey.key === 'company:99', 'prefer company id key');

const urlKey = LJF.buildCompanyIdentity({
  companyUrl: 'https://www.linkedin.com/company/acme/',
  displayName: 'Acme',
});
assert(urlKey.key === 'url:/company/acme/', 'prefer url key when no id');

const nameKey = LJF.buildCompanyIdentity({ displayName: 'Solo Nombre' });
assert(nameKey.key === 'name:solo nombre', 'fallback to normalized name');

const blocked = {
  'company:12345678': {
    key: 'company:12345678',
    companyId: '12345678',
    displayName: 'Beta Analytics',
  },
};
assert(
  LJF.matchesBlocked(
    { key: 'name:beta analytics', companyId: '12345678', displayName: 'Beta Analytics' },
    blocked
  ),
  'matchesBlocked by companyId cross-key'
);
assert(
  !LJF.matchesBlocked({ key: 'name:other', companyId: null, displayName: 'Other' }, blocked),
  'matchesBlocked rejects unrelated'
);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
