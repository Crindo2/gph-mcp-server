// Pre-deploy adversarial tests for GPH-MCP-SCHEMA-FIX-01 S3 (required-arg enforcement) and
// S4 (unknown-arg rejection). Every fixture below is a VERBATIM raw_args form replayed from
// gph-mcp-telemetry `mcp_usage_log` over 2026-06-24..2026-08-01 -- these are calls that were
// actually served wrongly in production, not invented cases.
//
//   node --test tests/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateArgs } from '../functions/mcp.js';

const ok = (tool, args) => assert.equal(validateArgs(tool, args), null,
  `${tool} ${JSON.stringify(args)} should have passed validation`);
const rejects = (tool, args) => {
  const r = validateArgs(tool, args);
  assert.ok(r && r.isError === true, `${tool} ${JSON.stringify(args)} should have been rejected`);
  return r.content[0].text;
};

// --- S3: declared-required enforcement -------------------------------------------------

test('S3: the whole-corpus exhibit is rejected instead of answered', () => {
  // Live 2026-07-27: {"query":"medical billing"} returned count 74,991 -- the entire
  // directory -- as the answer to an unqualified question. `query` is not a parameter AND
  // `category` is required; the unknown-arg branch reports first by design.
  const msg = rejects('search_providers', { query: 'medical billing' });
  assert.match(msg, /`query` is not a parameter/);
  assert.match(msg, /did you mean `category`/);
  assert.match(msg, /NOT run/);
});

test('S3: a bare call missing only the required arg names it and points at list_categories', () => {
  const msg = rejects('search_providers', { per_page: 10 });
  assert.match(msg, /requires `category`/);
  assert.match(msg, /list_categories/);
});

test('S3: match_practice enforces both of its required args', () => {
  // Live 2026-07-27: {"specialty":"Oncology","state":"CA","need":"medical supply"} was served.
  assert.match(rejects('match_practice', { specialty: 'Oncology', state: 'CA' }), /requires `category`/);
  assert.match(rejects('match_practice', { category: 'Medical Billing & RCM' }), /requires `state`/);
  assert.match(rejects('match_practice', {}), /requires `category` and `state`/);
});

test('S3: get_provider_detail enforces slug', () => {
  assert.match(rejects('get_provider_detail', {}), /requires `slug`/);
});

test('S3: empty-string and whitespace are treated as absent, not as a value', () => {
  assert.match(rejects('search_providers', { category: '' }), /requires `category`/);
  assert.match(rejects('search_providers', { category: '   ' }), /requires `category`/);
});

// --- S4: unknown-arg rejection with a nearest-name hint ---------------------------------

test('S4: the TX exhibit -- state_abbr no longer silently widens to national', () => {
  // Live 2026-07-27: {"category":"Medical Billing","state_abbr":"TX"} returned 7,092 rows,
  // the whole national billing corpus, because state_abbr was dropped rather than applied.
  const msg = rejects('search_providers', { category: 'Medical Billing', state_abbr: 'TX' });
  assert.match(msg, /`state_abbr` is not a parameter/);
  assert.match(msg, /did you mean `state`/);
  assert.match(msg, /wider result set than you asked for/);
});

test('S4: every off-schema arg observed in production is rejected with the right hint', () => {
  const cases = [
    ['match_practice', { category: 'medical-billing', specialty: 'cardiology', state: 'TX', size: 'small' }, /did you mean `practice_size`/],
    ['match_practice', { category: 'ehr', state: 'CA', practice_type: 'med-spa' }, /did you mean `specialty`/],
    ['match_practice', { category: 'Medical Billing', state: 'TX', specialty: 'Cardiology', budget: 'moderate' }, /did you mean `budget_range`/],
    ['match_practice', { category: 'medical-billing', state: 'TX', location: 'Austin, TX' }, /did you mean `city` and `state`/],
    ['match_practice', { category: 'Medical Billing', state: 'TX', ehr: 'Athenahealth' }, /did you mean `ehr_system`/],
    ['match_practice', { category: 'EHR', state_abbr: 'CA', practice_size: 'small' }, /did you mean `state`/],
    ['search_providers', { category: 'Medical Supply', limit: 5 }, /did you mean `per_page`/],
    ['search_providers', { category: 'Medical Billing', state: 'TX', min_quality_score: 80 }, /did you mean `min_rating`/],
  ];
  for (const [tool, args, expected] of cases) {
    assert.match(rejects(tool, args), expected, `${tool} ${JSON.stringify(args)}`);
  }
});

test('S4: specialty on search_providers routes the caller to match_practice', () => {
  // Live 2026-07-26: {"specialty":"dentistry","state":"TX","category":"medical billing"}
  // returned 682 rows with the specialty silently ignored. search_providers has no
  // specialty semantics and deliberately does not gain one here -- match_practice owns it.
  const msg = rejects('search_providers', { specialty: 'dentistry', state: 'TX', category: 'medical billing' });
  assert.match(msg, /use match_practice/);
  assert.doesNotMatch(msg, /did you mean/);
});

test('S4: multiple unknown args are all named in one error', () => {
  const msg = rejects('match_practice', { category: 'ehr', state: 'CA', size: 'small', practice_type: 'med-spa' });
  assert.match(msg, /`size`/);
  assert.match(msg, /`practice_type`/);
  assert.match(msg, /arguments for match_practice/);
});

// --- no-regression: correct callers are untouched ---------------------------------------

test('correct callers still pass -- verbatim organic forms from the baseline window', () => {
  ok('match_practice', { city: 'Dallas', state: 'TX', budget_range: '$500-$2,000', category: 'Medical Billing & RCM', specialty: 'Family Medicine', ehr_system: 'athenahealth', practice_size: 'Solo' });
  ok('search_providers', { category: 'Credentialing Services', min_rating: 80, page: 1, per_page: 10, state: 'CA' });
  ok('search_providers', { category: 'Healthcare IT & EHR', page: 1, per_page: 25, practice_size_fit: 'Solo/Small', tier1_grade: 'A' });
  ok('search_providers', { category: 'Medical Billing & RCM', per_page: 5 });
  ok('get_provider_detail', { slug: 'ams-solutions-inc-dallas-tx' });
  ok('match_practice', { category: 'Credentialing Services', city: 'Piggott', specialty: 'Family Medicine', state: 'AR' });
});

test('list_categories takes no arguments and requires none', () => {
  ok('list_categories', {});
  assert.match(rejects('list_categories', { category: 'billing' }), /`category` is not a parameter/);
});

test('an unknown tool name is left to callTool, not rejected here', () => {
  assert.equal(validateArgs('__verifymcp_auth_probe_deadbeef__', { anything: 1 }), null);
});
