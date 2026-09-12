// GPH-ENRICH-C1-VOCAB-PROVENANCE-01 -- the MCP consumers of the one closed vocabulary (C77-c)
// and the C77-b gate on the invented 'All sizes' literal.
//
// functions/_shared/practice-size-vocab.js is the source of truth (tests/practice-size-
// vocab.test.mjs proves the projection, byte-identical to Crindo2/getpracticehelp). THIS file
// proves this server reads it:
//   - the search_providers practice_size_fit enum IS the closed set, and match_practice's
//     practice_size enum is the closed set minus 'All';
//   - get_provider_detail renders the vocabulary label (enriched 'Medium' -> 'Mid-size',
//     legacy 'Solo/Small' unchanged) and, when the row asserts no size -- both columns
//     NULL/empty, or the unmappable legacy 'N/A' -- emits NO size line at all. The literal
//     'All sizes' is gone from the render path (C77-b(1)).
//   - C77-b(2): practice_size_fit_source is consumed -- the C50 note still renders on the
//     abstained cohort through the new line.
//
// These drive the REAL get_provider_detail path through callTool with fetch mocked.
// Run with Node >=20:  node --test tests/practice-size-vocab-mcp.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callTool, TOOLS } from '../functions/mcp.js';
import { PRACTICE_SIZE_VOCAB } from '../functions/_shared/practice-size-vocab.js';

const NOTE = '(legacy listing value, not extracted from public sources)';
const SIZE_LINE = /^\*\*Practice Size Fit:\*\* (.*)$/m;

const BASE = {
  id: 27, slug: 'virtru-national-us', company_name: 'Virtru',
  category: 'Compliance & HIPAA Services', city: '', state_abbr: '',
  website: 'https://www.virtru.com', quality_score: 55, verified: 1,
  description: 'Legacy description.', services_tags: 'legacy tag a, legacy tag b',
  enriched_services_tags: '[]', enriched_certifications: '[]', enriched_locations: null,
  enriched_founding_year: null, enriched_description: null, extraction_confidence: null, extraction_grounded_in: null,
};

async function detailText(row) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true, provider: row }) });
  try {
    const out = await callTool('get_provider_detail', { slug: row.slug });
    assert.ok(!out.isError, 'tool call succeeded');
    return out.content[0].text;
  } finally {
    globalThis.fetch = realFetch;
  }
}

const sizeLine = text => { const m = text.match(SIZE_LINE); return m ? m[1] : null; };

test('ENUM: search_providers.practice_size_fit enum == the closed set, exactly', () => {
  const tool = TOOLS.find(t => t.name === 'search_providers');
  assert.deepEqual(tool.inputSchema.properties.practice_size_fit.enum, [...PRACTICE_SIZE_VOCAB]);
  assert.deepEqual(tool.inputSchema.properties.practice_size_fit.enum, ['Solo', 'Small', 'Mid-size', 'Large', 'All']);
});

test("ENUM: match_practice.practice_size enum == the closed set minus 'All'", () => {
  const tool = TOOLS.find(t => t.name === 'match_practice');
  assert.deepEqual(tool.inputSchema.properties.practice_size.enum, PRACTICE_SIZE_VOCAB.filter(v => v !== 'All'));
  assert.deepEqual(tool.inputSchema.properties.practice_size.enum, ['Solo', 'Small', 'Mid-size', 'Large']);
});

test('RENDER: the size line carries the vocabulary label -- enriched Medium renders Mid-size', async () => {
  const text = await detailText({ ...BASE, practice_size_fit: 'All', enriched_practice_size_fit: 'Medium',
    enriched_description: 'ENRICHED.', extraction_confidence: 'high', extraction_grounded_in: 'site' });
  assert.equal(sizeLine(text), 'Mid-size');
  assert.ok(!text.includes(NOTE), 'the size IS extracted: no legacy note');
});

test('RENDER: legacy Solo/Small renders unchanged; legacy Mid-size renders unchanged (unenriched rows, Y2.1)', async () => {
  assert.equal(sizeLine(await detailText({ ...BASE, practice_size_fit: 'Solo/Small', enriched_practice_size_fit: null })), 'Solo/Small');
  assert.equal(sizeLine(await detailText({ ...BASE, practice_size_fit: 'Mid-size', enriched_practice_size_fit: null })), 'Mid-size');
  assert.equal(sizeLine(await detailText({ ...BASE, practice_size_fit: 'All', enriched_practice_size_fit: null })), 'All');
});

test('C77-b(1): both columns NULL -> NO size line and no invented literal anywhere in the profile', async () => {
  for (const legacy of [null, undefined, '', '   ']) {
    for (const enriched of [null, '']) {
      const text = await detailText({ ...BASE, practice_size_fit: legacy, enriched_practice_size_fit: enriched });
      assert.equal(sizeLine(text), null, `legacy=${JSON.stringify(legacy)} enriched=${JSON.stringify(enriched)} must emit no size line`);
      assert.ok(!text.includes('All sizes'), 'the invented literal must never be emitted');
      assert.ok(!/Practice Size Fit/.test(text));
    }
  }
});

test('C77-b(1): both columns NULL on an ENRICHED row (description extracted, size never asserted) -> no size line, grounding line stays', async () => {
  const text = await detailText({ ...BASE, practice_size_fit: null, enriched_practice_size_fit: null,
    enriched_description: 'ENRICHED.', extraction_confidence: 'high', extraction_grounded_in: 'site' });
  assert.equal(sizeLine(text), null);
  assert.ok(!text.includes('All sizes'));
  assert.ok(!text.includes(NOTE), 'no size, so nothing to attribute to a legacy source');
  assert.ok(text.includes('**Profile data:** extracted from public sources'), 'the description IS grounded; its sentence stays');
});

test('C77-c: the unmappable legacy N/A asserts nothing -> no size line', async () => {
  const text = await detailText({ ...BASE, practice_size_fit: 'N/A', enriched_practice_size_fit: null });
  assert.equal(sizeLine(text), null);
  assert.ok(!text.includes('N/A'));
});

test('C77-b(2): practice_size_fit_source IS consumed -- the C50 note renders on the abstained cohort through the new line', async () => {
  const text = await detailText({ ...BASE, practice_size_fit: 'Solo/Small', enriched_practice_size_fit: null,
    enriched_description: 'ENRICHED.', extraction_confidence: 'high', extraction_grounded_in: 'site' });
  assert.equal(sizeLine(text), `Solo/Small ${NOTE}`);
});

test('RENDER: no line of the profile ever carries a token outside the closed vocabulary as a size', async () => {
  const rows = [
    { practice_size_fit: 'Solo/Small', enriched_practice_size_fit: null },
    { practice_size_fit: 'Mid-size', enriched_practice_size_fit: 'Medium' },
    { practice_size_fit: 'All', enriched_practice_size_fit: 'Solo' },
    { practice_size_fit: 'Large', enriched_practice_size_fit: 'Small' },
  ];
  for (const r of rows) {
    const line = sizeLine(await detailText({ ...BASE, ...r }));
    assert.ok(line, 'a size line renders');
    for (const atom of line.replace(NOTE, '').trim().split('/')) {
      assert.ok(PRACTICE_SIZE_VOCAB.includes(atom), `${atom} is outside the closed set`);
    }
  }
});
