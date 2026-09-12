// GPH-PUBLISHED-CLAIMS-ACCURACY-01 / PC1-QUALITY-COMPLETENESS-DEFAULT0-DEMAND-FLIP (C79, GEN64
// ALLOC-PUBLISHED-CLAIMS-G64-20, 2026-09-12) -- the MCP half.
//
//   C79-a  getpracticehelp's `quality_score` is PROFILE COMPLETENESS, not a quality judgement.
//          This server rendered "Quality Score: N/100" / "Quality: N/100" / "**Quality Score:**"
//          in all three provider tools and described match_practice as "quality-scored, no paid
//          placement". Every caller-facing rendering and description now says what the column
//          measures ("completeness-scored, no paid placement"). JSON field names (quality_score,
//          min_rating) are the API contract and are NOT renamed.
//   C79-b  DEFAULT 0 never renders as a score: 0/NULL renders "not yet scored" (display only).
//   C79-d  `verified` prose is NOT touched here.
//
// These tests drive the REAL callTool paths with fetch mocked (same pattern as
// tests/practice-size-fit-provenance.test.mjs) and read the tool descriptions from source.
//
//   node --test tests/published-claims-c79.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { callTool } from '../functions/mcp.js';

const source = readFileSync(new URL('../functions/mcp.js', import.meta.url), 'utf8');
const glamaTools = JSON.parse(readFileSync(new URL('../glama-release/tools.json', import.meta.url), 'utf8'));
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

const ROW = {
  id: 27, slug: 'virtru-national-us', company_name: 'Virtru', category: 'Compliance & HIPAA Services',
  city: '', state_abbr: '', website: 'https://www.virtru.com', phone: '', verified: 1,
  description: 'Legacy description.', services_tags: 'legacy tag a, legacy tag b',
  practice_size_fit: 'Mid-size', enriched_description: null, enriched_practice_size_fit: null,
  enriched_services_tags: '[]', enriched_certifications: '[]', enriched_locations: null,
  enriched_founding_year: null, provenance: null, extraction_confidence: null, extraction_grounded_in: null,
  google_rating: null, google_review_count: null, final_score: 77, quality_score: 55,
};

async function withFetch(payload, fn) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => payload });
  try { return await fn(); } finally { globalThis.fetch = realFetch; }
}

const text = out => { assert.ok(!out.isError, 'tool call succeeded'); return out.content[0].text; };

// ---------------------------------------------------------------- C79-a: rendered text

test('C79-a (match_practice): renders Profile Completeness, never Quality Score', async () => {
  const t = await withFetch({ success: true, total: 1, matches: [ROW] },
    () => callTool('match_practice', { category: 'Compliance & HIPAA Services', state: 'TX' }).then(text));
  assert.ok(t.includes('Profile Completeness: 55/100'), t);
  assert.ok(!/Quality/.test(t), 'no "Quality" in match output');
  assert.ok(t.includes('Match Score: 77/100'), 'final_score line untouched');
});

test('C79-a (search_providers): renders Profile Completeness, never Quality', async () => {
  const t = await withFetch({ success: true, providers: [ROW], pagination: { total: 1 } },
    () => callTool('search_providers', { category: 'Compliance & HIPAA Services' }).then(text));
  assert.ok(t.includes('Profile Completeness: 55/100'), t);
  assert.ok(!/Quality/.test(t), 'no "Quality" in search output');
});

test('C79-a (get_provider_detail): renders Profile Completeness, never Quality Score', async () => {
  const t = await withFetch({ success: true, provider: ROW },
    () => callTool('get_provider_detail', { slug: ROW.slug }).then(text));
  assert.ok(t.includes('**Profile Completeness:** 55/100'), t);
  assert.ok(!/Quality/.test(t), 'no "Quality" in detail output');
});

// ---------------------------------------------------------------- C79-b: DEFAULT 0 never a score

test('C79-b (all three tools): quality_score 0 / null renders "not yet scored", never 0/100', async () => {
  for (const unset of [0, null, undefined]) {
    const row = { ...ROW, quality_score: unset };
    const m = await withFetch({ success: true, total: 1, matches: [row] },
      () => callTool('match_practice', { category: 'Compliance & HIPAA Services', state: 'TX' }).then(text));
    const s = await withFetch({ success: true, providers: [row], pagination: { total: 1 } },
      () => callTool('search_providers', { category: 'Compliance & HIPAA Services' }).then(text));
    const d = await withFetch({ success: true, provider: row },
      () => callTool('get_provider_detail', { slug: row.slug }).then(text));
    for (const [name, t] of [['match', m], ['search', s], ['detail', d]]) {
      assert.ok(t.includes('Profile Completeness: not yet scored') || t.includes('**Profile Completeness:** not yet scored'), `${name} @ ${unset}: ${t}`);
      assert.ok(!/[^0-9]0\/100/.test(t), `${name} @ ${unset}: no standalone 0/100`);
      assert.ok(!t.includes('null/100') && !t.includes('undefined/100'), `${name} @ ${unset}: no null/undefined score`);
    }
  }
});

test('C79-b: the verified fragment on the score line is untouched (C79-d is not this lane)', async () => {
  const d = await withFetch({ success: true, provider: { ...ROW, quality_score: 0, verified: 1 } },
    () => callTool('get_provider_detail', { slug: ROW.slug }).then(text));
  assert.ok(d.includes('**Profile Completeness:** not yet scored ✓ Verified Listing'), d);
});

// ---------------------------------------------------------------- C79-a: tool descriptions

test('C79-a (tool descriptions): "quality-scored" -> "completeness-scored"; quality_score annotated as completeness', () => {
  assert.ok(source.includes('(completeness-scored, no paid placement)'), 'match_practice description corrected');
  // Scoped to description strings; the explanatory comment above TOOLS names the old claim.
  const descriptions = source.match(/description: `[^`]*`/g) || [];
  assert.ok(descriptions.length >= 3, 'tool descriptions found');
  assert.ok(!descriptions.some(d => d.includes('quality-scored')), 'old claim gone from every description');
  assert.ok(!source.includes('minimum quality score'), 'search_providers description corrected');
  assert.ok(!/description: 'Minimum quality score/.test(source), 'min_rating description corrected');
  // Every "quality_score (0-100" mention in a tool description is annotated as completeness.
  const mentions = source.match(/quality_score \(0-100[^)]*\)/g) || [];
  assert.ok(mentions.length >= 3, `expected the three tool descriptions to mention quality_score; got ${mentions.length}`);
  for (const m of mentions) assert.match(m, /profile completeness/, m);
  // The JSON field and arg names are the API contract and were not renamed.
  assert.ok(source.includes("min_rating: { type: 'number'"), 'min_rating arg kept');
  assert.ok(source.includes('min_quality_score: \'min_rating\''), 'arg alias map kept');
});

test('C79-a (glama snapshot + README): the published copies carry the same correction', () => {
  for (const tool of glamaTools) {
    if (!tool.description) continue;
    assert.ok(!/minimum quality score|quality-scored/.test(tool.description), `${tool.name} description`);
    for (const m of tool.description.match(/quality_score \(0-100[^)]*\)/g) || []) assert.match(m, /profile completeness/, `${tool.name}: ${m}`);
  }
  const minRating = glamaTools.find(t => t.name === 'search_providers')?.inputSchema?.properties?.min_rating;
  assert.ok(minRating && /profile-completeness/.test(minRating.description), 'glama min_rating description');
  assert.ok(!/Quality scores\*\* based on Google ratings/.test(readme), 'README no longer attributes the score to Google ratings');
  assert.ok(readme.includes('**Profile-completeness scores**'), 'README names the measure');
  assert.ok(!/quality score|quality rating|quality scores/i.test(readme.replace(/not a quality (or reputation )?rating/gi, '')), 'README has no residual quality-score claim');
});
