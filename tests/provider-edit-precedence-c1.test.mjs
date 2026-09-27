// VENDOR-PRO-CODE-01 C1 (GEN100, ALLOC-VP-C1-G100-29, C417-C s.3) -- MCP-side proof that
// get_provider_detail resolves the SAME approved-provider_edits precedence as the web page,
// through the SAME byte-identical resolver block (pinned by
// tests/enrichment-resolver-differential.test.mjs against
// Crindo2/getpracticehelp functions/_shared/enrichment.js).
//
// get_provider_detail has no D1 access of its own -- it proxies
// GET /api/provider/:slug (functions/api/provider/[slug].js in the OTHER repo), which now
// attaches `approved_edits` to the response body. These tests mock that HTTP response exactly
// the way the existing practice-size-fit-provenance.test.mjs does, so the wiring under test is
// "does the resolver's precedence show up in the rendered tool text", not the HTTP fetch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callTool, resolveEnrichedProfile } from '../functions/mcp.js';

const BASE = {
  id: 27, slug: 'acme-billing', company_name: 'Acme Billing',
  category: 'Medical Billing & RCM', city: 'Nottingham', state_abbr: 'MD',
  website: 'https://acme-billing.example.com', quality_score: 72, verified: 0,
  description: 'Legacy description.', services_tags: 'legacy,tags', practice_size_fit: 'Small',
  enriched_services_tags: '[]', enriched_certifications: '[]', enriched_locations: null,
  enriched_founding_year: null, enriched_description: null, enriched_practice_size_fit: null,
  extraction_confidence: null, extraction_grounded_in: null,
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

test('an approved edit wins over enriched, through the MCP resolver too (same block, same precedence)', () => {
  const row = {
    ...BASE,
    enriched_description: 'Enriched description.',
    approved_edits: { description: 'Vendor wrote this via MCP.' },
  };
  const e = resolveEnrichedProfile(row);
  assert.equal(e.description, 'Vendor wrote this via MCP.');
  assert.equal(e.description_source, 'vendor_edit');
});

test('get_provider_detail renders the vendor-supplied value and label for an approved edit', async () => {
  const row = { ...BASE, approved_edits: { description: 'Vendor-approved About text.' } };
  const text = await detailText(row);
  assert.ok(text.includes('Vendor-approved About text. (vendor-supplied)'));
});

test('get_provider_detail renders no vendor-supplied label for a plain enriched row', async () => {
  const row = { ...BASE, enriched_description: 'Enriched description.' };
  const text = await detailText(row);
  assert.ok(text.includes('Enriched description.'));
  assert.ok(!text.includes('(vendor-supplied)'));
});

test('get_provider_detail renders no vendor-supplied label for a plain legacy row', async () => {
  const text = await detailText(BASE);
  assert.ok(text.includes('Legacy description.'));
  assert.ok(!text.includes('(vendor-supplied)'));
});

test('a pending/rejected edit never reaches this surface -- absent approved_edits resolves to enriched, unaffected', async () => {
  // The JSON API only ever attaches the LATEST APPROVED merge (functions/_shared/provider-
  // edit-precedence.js in the other repo filters status='approved' at the query). From this
  // repo's side, "pending/rejected is ignored" means: a response with no approved_edits key at
  // all (or an empty object) must resolve exactly as before this stage.
  const row = { ...BASE, enriched_description: 'Enriched description.', approved_edits: {} };
  const text = await detailText(row);
  assert.ok(text.includes('Enriched description.'));
  assert.ok(!text.includes('(vendor-supplied)'));
});

test('services_tags and practice_size_fit vendor-edit labels render independently of description', async () => {
  const row = {
    ...BASE,
    enriched_services_tags: JSON.stringify(['Enriched Tag']),
    enriched_practice_size_fit: 'Medium',
    approved_edits: { services_tags: 'vendor, tags', practice_size_fit: 'Small' },
  };
  const text = await detailText(row);
  assert.ok(text.includes('vendor, tags (vendor-supplied)'), 'services line carries the vendor value and label');
  assert.ok(text.match(/\*\*Practice Size Fit:\*\* .*\(vendor-supplied\)/), 'size line carries the vendor label');
  assert.ok(!text.includes('Enriched Tag'));
});
