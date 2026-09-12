// GPH-PRACTICE-GRAPH-PSF-C50-01 / T7-PRACTICE-SIZE-FIT-MISATTRIBUTION-REPAIR (C50, C52-d).
//
// Change 2 at MCP: never render the provenance claim over a discarded source. The resolver
// computes practice_size_fit_source ('enriched' | 'legacy') and get_provider_detail
// discarded it, so on an enriched row whose extractor ABSTAINED on size the legacy value
// printed above "**Profile data:** extracted from public sources (...)". Now the size line
// surfaces its own source on exactly that cohort, and nothing else changes: an unenriched
// row renders no claim and no note (Y2.1), and a row whose size IS enriched carries no note
// because the sentence genuinely applies to it.
//
// These tests drive the REAL get_provider_detail path through callTool with fetch mocked,
// rather than a copy of the render block.
//
// Run with Node >=20:
//   node --test tests/practice-size-fit-provenance.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callTool, resolveEnrichedProfile } from '../functions/mcp.js';

const NOTE = '(legacy listing value, not extracted from public sources)';
const CLAIM = '**Profile data:** extracted from public sources';

const BASE = {
  id: 27, slug: 'virtru-national-us', company_name: 'Virtru',
  category: 'Compliance & HIPAA Services', city: '', state_abbr: '',
  website: 'https://www.virtru.com', quality_score: 55, verified: 1,
  description: 'Legacy description.',
  services_tags: 'legacy tag a, legacy tag b',
  practice_size_fit: 'Mid-size',
  enriched_services_tags: '[]', enriched_certifications: '[]', enriched_locations: null,
  enriched_founding_year: null,
};

const ENRICHED_SIZE_ABSTAINED = {
  ...BASE,
  enriched_description: 'ENRICHED description.',
  enriched_practice_size_fit: null,
  extraction_confidence: 'high',
  extraction_grounded_in: 'site',
};

const ENRICHED_SIZE_PRESENT = { ...ENRICHED_SIZE_ABSTAINED, enriched_practice_size_fit: 'All' };

const LEGACY_ONLY = {
  ...BASE,
  enriched_description: null, enriched_practice_size_fit: null,
  extraction_confidence: null, extraction_grounded_in: null,
};

async function detailText(row) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/api\/provider\/virtru-national-us$/);
    return { ok: true, json: async () => ({ success: true, provider: row }) };
  };
  try {
    const out = await callTool('get_provider_detail', { slug: row.slug });
    assert.ok(!out.isError, 'tool call succeeded');
    return out.content[0].text;
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('C50 change 2 (MCP): an enriched row whose extractor abstained on size names the legacy source on the size line', async () => {
  const e = resolveEnrichedProfile(ENRICHED_SIZE_ABSTAINED);
  assert.equal(e.has_enrichment, true);
  assert.equal(e.practice_size_fit_source, 'legacy');
  const text = await detailText(ENRICHED_SIZE_ABSTAINED);
  assert.ok(text.includes(CLAIM), 'the profile-level grounding line still renders (description IS grounded)');
  assert.ok(text.includes(`**Practice Size Fit:** Mid-size ${NOTE}`), 'the size line names its own source');
});

test('C50 change 2 (MCP): an enriched row whose size IS extracted carries no note', async () => {
  const text = await detailText(ENRICHED_SIZE_PRESENT);
  assert.ok(text.includes(CLAIM));
  assert.ok(text.includes('**Practice Size Fit:** All\n'));
  assert.ok(!text.includes(NOTE));
});

test('C50 change 2 (MCP): an unenriched row renders no claim and no note (Y2.1)', async () => {
  const text = await detailText(LEGACY_ONLY);
  assert.ok(!text.includes(CLAIM));
  assert.ok(!text.includes(NOTE));
  assert.ok(text.includes('**Practice Size Fit:** Mid-size\n'));
});
