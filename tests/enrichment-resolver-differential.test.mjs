// REPO: Crindo2/gph-mcp-server -- the resolver lives inline in functions/mcp.js
import { resolveEnrichedProfile, enrichmentGroundingLabel, parseJsonList } from '../functions/mcp.js';
const RESOLVER_REL = '../functions/mcp.js';

// DIFFERENTIAL CI CHECK for the duplicated enrichment resolver.
// GPH-VENDOR-ENRICHMENT-01 P2 REPAIR -- CHAT blob d136494c Y2.4(a), ALLOC-GPH-P2-REPAIR-G59-001.
//
// THE DEFECT THIS EXISTS TO PREVENT RECURRING. The enrichment resolver is duplicated across
// Crindo2/getpracticehelp (functions/_shared/enrichment.js) and Crindo2/gph-mcp-server
// (functions/mcp.js) because the two repos do not share a module. On day one the copies were
// already TEXTUALLY divergent on 2 of their 4 functions, and nothing in either repo compared
// them. They happened to be behaviourally identical over 2,395,575 differential row-field
// comparisons -- but nothing kept them that way, and the next edit to one of them would have
// silently split the public page from what MCP tells a model about the same vendor.
//
// HOW IT FAILS ON DIVERGENCE. Two independent assertions, neither of which needs the network:
//   1. STRUCTURAL -- each repo extracts its own sentinel-delimited ENRICHMENT-RESOLVER-V2
//      block, normalises CRLF to LF, and asserts its SHA-256 equals the value pinned in
//      tests/fixtures/enrichment-resolver.lock.json. That lock file is committed IDENTICALLY
//      in both repos. Edit one repo's resolver and that repo's `gates` job fails.
//   2. BEHAVIOURAL -- each repo replays tests/fixtures/enrichment-resolver-fixture.jsonl (12
//      real production rows, read live from D1 7a06fa73, no invented values) through its OWN
//      resolver and asserts the output deep-equals tests/fixtures/enrichment-resolver-
//      expected.json -- also committed identically in both repos. Same input row set,
//      identical output, fail on divergence. This is the assertion that survives a
//      cosmetically-reformatted-but-behaviourally-changed edit.
//
// In getpracticehelp the `gates` workflow additionally fetches gph-mcp-server's public
// functions/mcp.js at PR time and compares the live block hash across repos, which closes the
// case where both repos are edited in the same way but the lock file is not updated.
//
// The fixture rows deliberately cover every branch: fully enriched; enriched with the
// enriched/Apollo founding-year DISAGREEMENT (healthware, 1996 vs 1998); enriched with the
// two years agreeing; enriched with NO enriched_description (the 476-row partial cohort);
// '[]' empty-array encodings; extraction_grounded_in unmapped ('serper') and free-text;
// non-NULL provenance; unenriched with apollo_founded_year and legacy services_tags;
// unenriched with a NULL description; unenriched plain.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures');
// RESOLVER_REL is the ONLY per-repo line in this file; everything below is identical in both.
const RESOLVER_SOURCE = path.join(HERE, RESOLVER_REL);
const SENTINEL =
  /\/\/ >>> ENRICHMENT-RESOLVER-V2 BEGIN >>>[\s\S]*?\/\/ <<< ENRICHMENT-RESOLVER-V2 END <<</;

const lf = s => s.replace(/\r\n/g, '\n');
const sha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const readLf = p => lf(fs.readFileSync(p, 'utf8'));

const lock = JSON.parse(readLf(path.join(FIX, 'enrichment-resolver.lock.json')));

test('DIFFERENTIAL 1/3: this repo\'s resolver block is byte-identical to the pinned contract', () => {
  const src = readLf(RESOLVER_SOURCE);
  const m = src.match(SENTINEL);
  assert.ok(m, `no ENRICHMENT-RESOLVER-V2 sentinel block found in ${RESOLVER_SOURCE} -- the ` +
    'differential contract cannot be checked, which is itself the failure');
  const got = sha256(m[0]);
  assert.equal(got, lock.block_sha256_lf,
    'The ENRICHMENT-RESOLVER-V2 block in this repo no longer matches the pinned contract.\n' +
    'This block is duplicated in Crindo2/getpracticehelp functions/_shared/enrichment.js and\n' +
    'Crindo2/gph-mcp-server functions/mcp.js and MUST stay byte-identical. Land the same edit\n' +
    'in BOTH repos, regenerate tests/fixtures/enrichment-resolver-expected.json, and update\n' +
    `enrichment-resolver.lock.json in BOTH repos.\n  expected ${lock.block_sha256_lf}\n  got      ${got}`);
  assert.equal(m[0].length, lock.block_chars_lf);
});

test('DIFFERENTIAL 2/3: the shared fixture and expected output are the pinned ones', () => {
  assert.equal(sha256(readLf(path.join(FIX, 'enrichment-resolver-fixture.jsonl'))),
    lock.fixture_sha256_lf, 'the shared production-row fixture has been altered');
  assert.equal(sha256(readLf(path.join(FIX, 'enrichment-resolver-expected.json'))),
    lock.expected_sha256_lf, 'the shared expected-output artifact has been altered');
});

test('DIFFERENTIAL 3/3: same input row set -> identical output (fail on divergence)', () => {
  const rows = readLf(path.join(FIX, 'enrichment-resolver-fixture.jsonl'))
    .trim().split('\n').map(l => JSON.parse(l));
  const expected = JSON.parse(readLf(path.join(FIX, 'enrichment-resolver-expected.json')));
  assert.equal(rows.length, lock.fixture_rows);
  assert.equal(expected.length, rows.length);

  const actual = rows.map(r => {
    const e = resolveEnrichedProfile(r);
    return { id: r.id, slug: r.slug, resolved: e, grounding_label: enrichmentGroundingLabel(e) };
  });

  for (let i = 0; i < expected.length; i++) {
    assert.deepEqual(actual[i], expected[i],
      `resolver output diverged on fixture row ${expected[i].id} (${expected[i].slug}). ` +
      'Both repos assert against this same artifact, so one of them is now producing a ' +
      'different vendor profile from the other.');
  }
});

// --- the three Y2 rulings, asserted on real rows rather than on invented ones -------------

const byId = id => JSON.parse(readLf(path.join(FIX, 'enrichment-resolver-fixture.jsonl'))
  .trim().split('\n').find(l => JSON.parse(l).id === id));

test('Y2.1: an unenriched row resolves to the verbatim pre-P2 legacy values', () => {
  // id 29, birch-horton-bittner-cherot-anchorage-ak: no enriched_* at all, but it DOES carry
  // apollo_founded_year 1971 and a legacy services_tags string. Before the repair those two
  // put a "Founded" section and a JSON-LD knowsAbout on this page.
  const row = byId(29);
  const e = resolveEnrichedProfile(row);
  assert.equal(e.has_enrichment, false);
  assert.equal(e.description, row.description, 'description must be the legacy column verbatim');
  assert.deepEqual(e.services_tags,
    (row.services_tags || '').split(',').map(t => t.trim()).filter(Boolean),
    'tags must be the verbatim pre-P2 comma split, not parseJsonList');
  assert.deepEqual(e.certifications, []);
  assert.deepEqual(e.locations, []);
  assert.equal(e.practice_size_fit, row.practice_size_fit);
  assert.equal(e.founding_year, null, 'no Founded value may resolve on an unenriched row');
  assert.equal(enrichmentGroundingLabel(e), '', 'no grounding block on an unenriched row');
});

test('Y2.1: an unenriched row with a NULL description resolves to null, not to the empty string', () => {
  // Pre-P2 rendered `provider.description`. Resolving null to '' is a byte difference on
  // every such page, which is why byte-identity and not "looks the same" is the test.
  const row = byId(103375);
  assert.equal(row.description, null);
  assert.equal(resolveEnrichedProfile(row).description, null);
});

test('Y2.2: apollo_founded_year never becomes a rendered founding year, enriched or not', () => {
  for (const id of [29, 2513, 103375, 103379]) {
    const e = resolveEnrichedProfile(byId(id));
    assert.equal(e.has_enrichment, false);
    assert.equal(e.founding_year, null, `row ${id}: Apollo must not ship as a founding year`);
  }
  // ...and not as the sole source on an enriched row either: the only grounding disclosure
  // this release renders describes the ENRICHMENT extraction, so an Apollo year underneath it
  // would be attributed to an extraction that never produced it.
  const partial = resolveEnrichedProfile(byId(1522));
  assert.equal(partial.has_enrichment, true);
  assert.equal(partial.founding_year, null);
});

test('Y2.3: where enriched and Apollo founding years disagree, the enriched value wins and Apollo is not rendered', () => {
  // healthware-systems-elgin-il -- the disagreement named in the ruling: enriched 1996 vs
  // Apollo 1998. 224 servable rows are in this state today.
  const row = byId(8022);
  const e = resolveEnrichedProfile(row);
  assert.equal(String(row.enriched_founding_year), '1996');
  assert.equal(String(row.apollo_founded_year), '1998');
  assert.equal(e.founding_year_disagrees, true);
  assert.equal(String(e.founding_year), '1996');
  assert.equal(e.founding_year_source, 'enriched');
  assert.notEqual(String(e.founding_year), String(row.apollo_founded_year));
});

test('Y2.3: agreeing years are not reported as a disagreement', () => {
  // caspio-national-us: enriched_founding_year is an INTEGER 2000, apollo_founded_year the
  // TEXT "2000". A naive !== on the raw column types would call this a disagreement.
  const e = resolveEnrichedProfile(byId(2));
  assert.equal(e.founding_year_disagrees, false);
  assert.equal(String(e.founding_year), '2000');
});

test('Q1: a NULL provenance never withholds enriched content (5,713 of 5,715 rows)', () => {
  // amendment 083b18fe Q1 -- provenance sparsity is not a grounding defect. The label falls
  // through to extraction_grounded_in, which is populated on all 5,715.
  const row = byId(27); // virtru-national-us, provenance NULL
  const e = resolveEnrichedProfile(row);
  assert.equal(row.provenance, null);
  assert.equal(e.has_enrichment, true);
  assert.ok(e.description && e.description.length > 0);
  assert.ok(enrichmentGroundingLabel(e).includes('sourced from'),
    'a null provenance must still produce a grounding label from extraction_grounded_in');
});

test('empty-array encodings read as absent, not as an empty section', () => {
  // compliancy-group-national-us carries enriched_certifications = "[]" and
  // enriched_locations = "[]" -- the live table's empty encoding.
  const e = resolveEnrichedProfile(byId(6));
  assert.deepEqual(e.certifications, []);
  assert.deepEqual(e.locations, []);
  assert.deepEqual(parseJsonList('[]'), []);
  assert.deepEqual(parseJsonList('""'), []);
  assert.deepEqual(parseJsonList('null'), []);
  assert.deepEqual(parseJsonList(null), []);
});
