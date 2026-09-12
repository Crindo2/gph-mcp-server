// PRACTICE-SIZE-VOCAB-V1 -- GPH-ENRICH-C1-VOCAB-PROVENANCE-01 (C77-c).
//
// This test file and functions/_shared/practice-size-vocab.js are IDENTICAL in
// Crindo2/getpracticehelp and Crindo2/gph-mcp-server. Test 1 pins the module's sentinel block
// to tests/fixtures/practice-size-vocab.lock.json (same mechanism as ENRICHMENT-RESOLVER-V2);
// the remaining tests assert the contract C77-c names:
//   - the projection is TOTAL over every stored token observed on D1 7a06fa73 (2026-09-12),
//   - exactly one token is unmappable and it is named with its count,
//   - the same vocabulary value names the same rows whichever column it came from,
//   - request-side values callers actually send project onto the closed set.
//
// Run with Node >=20:  node --test tests/practice-size-vocab.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  PRACTICE_SIZE_VOCAB, LEGACY_PROJECTION, ENRICHED_PROJECTION, UNMAPPABLE,
  projectStoredSize, projectRequestedSize, resolvePracticeSize, practiceSizeLabel,
  storedTokensFor, practiceSizeFilterSql,
} from '../functions/_shared/practice-size-vocab.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(HERE, '..', 'functions', '_shared', 'practice-size-vocab.js');
const SENTINEL = /\/\/ >>> PRACTICE-SIZE-VOCAB-V1 BEGIN >>>[\s\S]*?\/\/ <<< PRACTICE-SIZE-VOCAB-V1 END <<</;
const lf = s => s.replace(/\r\n/g, '\n');
const sha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const lock = JSON.parse(lf(fs.readFileSync(path.join(HERE, 'fixtures', 'practice-size-vocab.lock.json'), 'utf8')));

// The eleven stored tokens observed on D1 7a06fa73 (SELECT ... GROUP BY, counts only).
// If D1 grows a twelfth, add it HERE and to the projection in the same change.
const OBSERVED_LEGACY = { 'Solo/Small': 42783, 'Mid-size': 25369, 'All': 6081, 'Large': 2720, 'Small': 13, 'N/A': 11 };
const OBSERVED_ENRICHED = { 'All': 1087, 'Small': 309, 'Large': 84, 'Medium': 14, 'Solo': 8 };

test('VOCAB 1: the sentinel block is byte-identical to the pinned cross-repo contract', () => {
  const m = lf(fs.readFileSync(SOURCE, 'utf8')).match(SENTINEL);
  assert.ok(m, 'no PRACTICE-SIZE-VOCAB-V1 sentinel block found');
  const got = sha256(m[0]);
  assert.equal(got, lock.block_sha256_lf,
    'The PRACTICE-SIZE-VOCAB-V1 block no longer matches the pinned contract. It is duplicated in\n' +
    'Crindo2/getpracticehelp and Crindo2/gph-mcp-server (functions/_shared/practice-size-vocab.js)\n' +
    `and MUST stay byte-identical; land the same edit and lock in BOTH repos.\n  expected ${lock.block_sha256_lf}\n  got      ${got}`);
  assert.equal(m[0].length, lock.block_chars_lf);
});

test('VOCAB 2: the closed set is exactly five tokens, frozen, no duplicates', () => {
  assert.deepEqual([...PRACTICE_SIZE_VOCAB], ['Solo', 'Small', 'Mid-size', 'Large', 'All']);
  assert.ok(Object.isFrozen(PRACTICE_SIZE_VOCAB));
  assert.equal(new Set(PRACTICE_SIZE_VOCAB).size, PRACTICE_SIZE_VOCAB.length);
});

test('VOCAB 3: the projection is TOTAL over every observed stored token, on both columns', () => {
  assert.deepEqual(Object.keys(LEGACY_PROJECTION).sort(), Object.keys(OBSERVED_LEGACY).sort(),
    'legacy projection keys must be exactly the observed legacy tokens');
  assert.deepEqual(Object.keys(ENRICHED_PROJECTION).sort(), Object.keys(OBSERVED_ENRICHED).sort(),
    'enriched projection keys must be exactly the observed enriched tokens');
  const unmappableLegacy = new Set(UNMAPPABLE.legacy.map(u => u.token));
  const unmappableEnriched = new Set(UNMAPPABLE.enriched.map(u => u.token));
  for (const tok of Object.keys(OBSERVED_LEGACY)) {
    const out = projectStoredSize(tok, 'legacy');
    for (const v of out) assert.ok(PRACTICE_SIZE_VOCAB.includes(v), `${tok} -> ${v} is outside the closed set`);
    if (out.length === 0) assert.ok(unmappableLegacy.has(tok), `legacy '${tok}' maps to nothing but is not named in UNMAPPABLE`);
    else assert.ok(!unmappableLegacy.has(tok), `legacy '${tok}' is named unmappable but projects`);
  }
  for (const tok of Object.keys(OBSERVED_ENRICHED)) {
    const out = projectStoredSize(tok, 'enriched');
    assert.ok(out.length > 0, `enriched '${tok}' must project`);
    for (const v of out) assert.ok(PRACTICE_SIZE_VOCAB.includes(v), `${tok} -> ${v} is outside the closed set`);
    assert.ok(!unmappableEnriched.has(tok));
  }
});

test('VOCAB 4: exactly one unmappable token, legacy N/A, named with its row count', () => {
  assert.deepEqual(UNMAPPABLE.legacy.map(u => u.token), ['N/A']);
  assert.equal(UNMAPPABLE.legacy[0].rows, OBSERVED_LEGACY['N/A']);
  assert.deepEqual([...UNMAPPABLE.enriched], []);
  assert.deepEqual(projectStoredSize('N/A', 'legacy'), []);
});

test('VOCAB 5: the specific projections C77-c names', () => {
  assert.deepEqual(projectStoredSize('Solo/Small', 'legacy'), ['Solo', 'Small'], 'compound spans two atoms');
  assert.deepEqual(projectStoredSize('Mid-size', 'legacy'), ['Mid-size']);
  assert.deepEqual(projectStoredSize('Medium', 'enriched'), ['Mid-size'], 'same concept, two encodings');
  for (const tok of ['All', 'Small', 'Large']) {
    assert.deepEqual(projectStoredSize(tok, 'legacy'), projectStoredSize(tok, 'enriched'), `shared token ${tok} agrees`);
  }
  assert.deepEqual(projectStoredSize('Solo', 'enriched'), ['Solo']);
  // Column-specific: 'Medium' is not a legacy token and 'Mid-size' is not an enriched one.
  assert.deepEqual(projectStoredSize('Medium', 'legacy'), []);
  assert.deepEqual(projectStoredSize('Mid-size', 'enriched'), []);
  // NULL / empty / whitespace assert nothing.
  for (const v of [null, undefined, '', '   ']) {
    assert.deepEqual(projectStoredSize(v, 'legacy'), []);
    assert.deepEqual(projectStoredSize(v, 'enriched'), []);
  }
});

test('VOCAB 6: resolution is enriched-first, then legacy, then nothing -- same rule as the resolver', () => {
  assert.deepEqual(resolvePracticeSize({ practice_size_fit: 'Mid-size', enriched_practice_size_fit: 'Small' }),
    { values: ['Small'], source: 'enriched', raw: 'Small' });
  assert.deepEqual(resolvePracticeSize({ practice_size_fit: 'Mid-size', enriched_practice_size_fit: null }),
    { values: ['Mid-size'], source: 'legacy', raw: 'Mid-size' });
  assert.deepEqual(resolvePracticeSize({ practice_size_fit: 'Mid-size', enriched_practice_size_fit: '' }),
    { values: ['Mid-size'], source: 'legacy', raw: 'Mid-size' });
  assert.deepEqual(resolvePracticeSize({ practice_size_fit: null, enriched_practice_size_fit: null }),
    { values: [], source: 'none', raw: null });
  assert.deepEqual(resolvePracticeSize({}), { values: [], source: 'none', raw: null });
  assert.deepEqual(resolvePracticeSize({ practice_size_fit: 'N/A' }), { values: [], source: 'legacy', raw: 'N/A' });
});

test('VOCAB 7: display labels re-join atoms; nothing is invented for nothing', () => {
  assert.equal(practiceSizeLabel(['Solo', 'Small']), 'Solo/Small', 'legacy compound renders unchanged');
  assert.equal(practiceSizeLabel(['Small', 'Solo']), 'Solo/Small', 'vocabulary order, not input order');
  assert.equal(practiceSizeLabel(['Mid-size']), 'Mid-size');
  assert.equal(practiceSizeLabel(['All']), 'All');
  assert.equal(practiceSizeLabel([]), null);
  assert.equal(practiceSizeLabel(null), null);
  assert.equal(practiceSizeLabel(['Bogus']), null, 'a value outside the set is not a label');
});

test('VOCAB 8: request-side values callers actually send project onto the closed set', () => {
  // match_sessions.practice_size DISTINCT (counts only, 2026-09-12) and the two MCP enums.
  const cases = {
    'Solo': ['Solo'], 'Small': ['Small'], 'Mid-size': ['Mid-size'], 'Large': ['Large'], 'All': ['All'],
    'small': ['Small'], 'medium': ['Mid-size'], 'SOLO': ['Solo'],
    'Solo (1-2)': ['Solo'], 'Small (3-10)': ['Small'], 'Mid-size (11-25)': ['Mid-size'], 'Large (25+)': ['Large'],
    'Solo (1 provider)': ['Solo'], 'All sizes': ['All'], 'Midsize': ['Mid-size'],
    'Solo/Small': ['Solo', 'Small'],
    // Free-text head counts are NOT classified into buckets -- nobody has ruled on that.
    '2-5': [], '2_5': [], '2-5 providers': [], '1-5': [], '16+': [], '4.0': [], '3 locations': [], '': [], '   ': [],
  };
  for (const [input, expected] of Object.entries(cases)) {
    assert.deepEqual(projectRequestedSize(input), expected, `projectRequestedSize(${JSON.stringify(input)})`);
  }
  assert.deepEqual(projectRequestedSize(null), []);
  assert.deepEqual(projectRequestedSize(undefined), []);
  for (const v of PRACTICE_SIZE_VOCAB) assert.deepEqual(projectRequestedSize(v), [v], `${v} round-trips`);
});

test('VOCAB 9: storedTokensFor inverts the projection on each column', () => {
  assert.deepEqual(storedTokensFor(['Small'], 'legacy').sort(), ['Small', 'Solo/Small']);
  assert.deepEqual(storedTokensFor(['Solo'], 'legacy'), ['Solo/Small']);
  assert.deepEqual(storedTokensFor(['Mid-size'], 'legacy'), ['Mid-size']);
  assert.deepEqual(storedTokensFor(['Mid-size'], 'enriched'), ['Medium']);
  assert.deepEqual(storedTokensFor(['Solo'], 'enriched'), ['Solo']);
  assert.deepEqual(storedTokensFor(['All'], 'legacy'), ['All']);
  assert.deepEqual(storedTokensFor([], 'legacy'), []);
  // N/A inverts to nothing: no vocabulary value ever selects it.
  for (const v of PRACTICE_SIZE_VOCAB) assert.ok(!storedTokensFor([v], 'legacy').includes('N/A'));
});

test('VOCAB 10: the SQL fragment binds only stored tokens, never caller text, and is closed on empty input', () => {
  const { sql, binds } = practiceSizeFilterSql(['Mid-size']);
  assert.match(sql, /enriched_practice_size_fit/);
  assert.match(sql, /practice_size_fit/);
  assert.deepEqual(binds, ['Medium', 'Mid-size']);
  assert.equal((sql.match(/\?/g) || []).length, binds.length, 'placeholder count equals bind count');
  for (const b of binds) assert.ok(b in ENRICHED_PROJECTION || b in LEGACY_PROJECTION, `${b} is a stored token`);
  assert.deepEqual(practiceSizeFilterSql([]), { sql: '0', binds: [] });
  assert.deepEqual(practiceSizeFilterSql(['Bogus']), { sql: '0', binds: [] });
  // 'Solo' has no dedicated legacy token: the legacy branch must still bind the compound.
  assert.deepEqual(practiceSizeFilterSql(['Solo']).binds, ['Solo', 'Solo/Small']);
});
