// C2284 s.5: page pointers. Offline: a table test over every address the code can emit, plus one response per tool
// family. The live 200 check is scripts/check-page-pointers.mjs (records tests/fixtures/page-pointers-verified.json).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { callTool } from '../functions/mcp.js';
import * as pp from '../functions/_shared/page-pointers.js';

const VERIFIED = JSON.parse(readFileSync(new URL('./fixtures/page-pointers-verified.json', import.meta.url), 'utf8'));
const MARK = 'utm_source=mcp-page-pointer';
const real = globalThis.fetch;
afterEach(() => { globalThis.fetch = real; });
const mock = (fn) => { globalThis.fetch = async (url, opts) => fn(String(url), opts); };

test('the recorded build-time check covers the whole table and every address answered 200', () => {
  const table = pp.allFixedPaths();
  assert.ok(table.length > 300);
  assert.deepEqual(VERIFIED.failures, []);
  assert.equal(VERIFIED.fixed_addresses_checked, VERIFIED.fixed_addresses_200);
  assert.equal(VERIFIED.provider_samples_built, VERIFIED.provider_samples_200);
  assert.ok(VERIFIED.provider_samples_built >= 20);
  assert.deepEqual(table, [...VERIFIED.ok_paths].sort(), 'every address in the table was checked and answered 200; nothing checked is missing');
});

test('every address in the table is a real-shaped site path with exactly one marker and no person data', () => {
  for (const p of pp.allFixedPaths()) {
    assert.match(p, /^\/[a-z0-9\/-]+\/$/, p);
    assert.ok(!/[?#=@]/.test(p), p);
  }
  const u = new URL(pp.ehrProductPointer('epic').url);
  assert.equal(u.origin, 'https://www.getpracticehelp.com');
  assert.equal([...u.searchParams.keys()].join(','), 'utm_source');
  assert.equal(u.searchParams.get('utm_source'), 'mcp-page-pointer');
});

test('table mapping rules', () => {
  // category: guide where there is one, directory hub otherwise, state guide only where the state has one
  assert.match(pp.categoryPointer('Medical Billing & RCM', undefined).url, /\/medical-billing-rcm\/best-medical-billing-companies\/\?/);
  assert.match(pp.categoryPointer('Medical Billing & RCM', 'TX').url, /\/guides\/medical-billing-tx\/\?/);
  assert.match(pp.categoryPointer('Medical Billing & RCM', 'ID').url, /\/medical-billing-rcm\/best-medical-billing-companies\//, 'no Idaho guide, so the ranked page');
  assert.match(pp.categoryPointer('Credentialing Services', 'ca').url, /\/guides\/credentialing-services-ca\//);
  assert.match(pp.categoryPointer('Credentialing Services', 'AZ').url, /\/credentialing\/best-credentialing-companies\//);
  assert.match(pp.categoryPointer('Healthcare Legal Services', 'TX').url, /\/providers\/healthcare-legal-services\/\?/);
  // no match: unknown category, nothing
  assert.equal(pp.categoryPointer('Not A Category', 'TX'), null);
  assert.equal(pp.categoryPointer(undefined, 'TX'), null);
  // EHR: every product in the tool's own list maps to a page that mentions it, none to an invented one
  assert.equal(Object.keys(pp.EHR_PRODUCTS).length, 19);
  assert.match(pp.ehrProductPointer('simplepractice').url, /\/ehr\/best-ehr-small-practices\//);
  assert.match(pp.ehrProductPointer('therapynotes').url, /\/ehr\/best-ehr-mental-health-practices-2026\//);
  assert.match(pp.ehrProductPointer('epic').url, /\/ehr\/ehr-pricing-transparency\//);
  assert.equal(pp.ehrProductPointer('not-a-product'), null);
  assert.equal(pp.ehrProductPointer('constructor'), null);
  // data
  assert.match(pp.dataPointer('TX', 'dental').url, /\/data\/coverage\/tx\/dental\//);
  assert.match(pp.dataPointer('TX', undefined).url, /\/data\/\?/);
  assert.match(pp.dataPointer('ZZ', 'dental').url, /\/data\/\?/);
  // provider: built only from the record
  assert.match(pp.providerPointer({ slug: 'a-b-c', category: 'Healthcare IT & EHR', state_abbr: 'NY', city_slug: 'hawthorne' }).url, /\/providers\/healthcare-it-ehr\/ny\/hawthorne\/a-b-c\/\?/);
  assert.match(pp.providerPointer({ slug: 'a-b-c', category: 'Healthcare IT & EHR', state_abbr: null, city_slug: null }).url, /\/providers\/healthcare-it-ehr\/us\/national\/a-b-c\//);
  assert.equal(pp.providerPointer({ slug: 'a-b-c', category: 'Mystery' }), null);
  assert.equal(pp.providerPointer({ slug: '../x', category: 'Healthcare IT & EHR' }), null);
  assert.equal(pp.providerPointer(null), null);
});

test('descriptions are one plain ASCII line, no dashes', () => {
  const all = [
    pp.categoriesPointer(), pp.dataPointer(), pp.dataPointer('TX', 'dental'), pp.categoryPointer('Medical Billing & RCM'), pp.categoryPointer('Medical Billing & RCM', 'TX'),
    pp.categoryPointer('Credentialing Services', 'TX'), pp.categoryPointer('Credentialing Services'), pp.categoryPointer('Practice Management Consulting'), pp.categoryPointer('Healthcare Legal Services'),
    ...Object.keys(pp.EHR_PRODUCTS).map(pp.ehrProductPointer),
    pp.providerPointer({ slug: 'x', category: 'Healthcare IT & EHR', state_abbr: 'NY', city_slug: 'y' }),
  ];
  for (const { description } of all) {
    assert.match(description, /^[\x20-\x7e]+$/);
    assert.ok(!/[-]{2}|\s-\s/.test(description), description);
    assert.ok(description.length > 30 && description.length < 200, description);
    assert.ok(description.endsWith('.'), description);
  }
});

test('match_practice: pointer follows the category the results carry; empty result and error carry none', async () => {
  mock(() => Response.json({ success: true, total: 2, matches: [{ company_name: 'Acme', category: 'Medical Billing & RCM', city: 'Austin', state_abbr: 'TX', slug: 'acme-austin-tx', final_score: 80 }] }));
  const r = await callTool('match_practice', { category: 'RCM', state: 'TX' });
  assert.equal(r.page_pointer.url, `https://www.getpracticehelp.com/guides/medical-billing-tx/?${MARK}`);
  assert.equal(r.pageHint, undefined);
  assert.equal(r.content.at(-1).text.startsWith('\n\nSource: '), true, 'the C1569 citation is untouched');
  mock(() => Response.json({ success: true, total: 0, matches: [] }));
  assert.equal('page_pointer' in await callTool('match_practice', { category: 'RCM', state: 'TX' }), false);
  mock(() => Response.json({ success: false, error: 'x' }));
  assert.equal('page_pointer' in await callTool('match_practice', { category: 'RCM', state: 'TX' }), false);
});

test('search_providers: category page from the results; empty page carries none', async () => {
  mock(() => Response.json({ success: true, pagination: { total: 1 }, providers: [{ slug: 's', company_name: 'Acme', category: 'Credentialing Services', city: 'Dallas', state_abbr: 'TX' }] }));
  const r = await callTool('search_providers', { category: 'credentialing', state: 'TX' });
  assert.equal(r.page_pointer.url, `https://www.getpracticehelp.com/guides/credentialing-services-tx/?${MARK}`);
  mock(() => Response.json({ success: true, pagination: { total: 0 }, providers: [] }));
  assert.equal('page_pointer' in await callTool('search_providers', { category: 'credentialing' }), false);
});

test('get_provider_detail: provider page from the stored record; unknown slug carries none', async () => {
  mock(() => Response.json({ success: true, provider: { slug: 'omni-hawthorne-ny', company_name: 'Omni', category: 'Healthcare IT & EHR', city: 'Hawthorne', city_slug: 'hawthorne', state_abbr: 'NY', quality_score: 85 } }));
  const r = await callTool('get_provider_detail', { slug: 'omni-hawthorne-ny' });
  assert.equal(r.page_pointer.url, `https://www.getpracticehelp.com/providers/healthcare-it-ehr/ny/hawthorne/omni-hawthorne-ny/?${MARK}`);
  mock(() => new Response('{}', { status: 404 }));
  assert.equal('page_pointer' in await callTool('get_provider_detail', { slug: 'nope' }), false);
});

test('list_categories, get_ehr_product_detail and practice_data_counts', async () => {
  mock(() => Response.json({ success: true, total_providers: 10, categories: [{ category: 'Medical Billing & RCM', slug: 'medical-billing-rcm', providers: 10 }] }));
  assert.equal((await callTool('list_categories', {})).page_pointer.url, `https://www.getpracticehelp.com/providers/?${MARK}`);
  mock(() => Response.json({ schema_version: '1.0.0', product: { product_key: 'epic' } }));
  assert.equal((await callTool('get_ehr_product_detail', { product_key: 'epic' })).page_pointer.url, `https://www.getpracticehelp.com/ehr/ehr-pricing-transparency/?${MARK}`);
  mock(() => Response.json({ schema_version: '1.0.0', error: 'product_not_found' }, { status: 404 }));
  assert.equal('page_pointer' in await callTool('get_ehr_product_detail', { product_key: 'unknown-product' }), false);
});

test('practice_data_counts: coverage page for a state and segment, the data page otherwise, none on upstream error', async () => {
  mock(() => Response.json({ cells: [] }));
  assert.equal((await callTool('practice_data_counts', { state: 'TX', segment: 'dental' })).page_pointer.url, `https://www.getpracticehelp.com/data/coverage/tx/dental/?${MARK}`);
  assert.equal((await callTool('practice_data_counts', {})).page_pointer.url, `https://www.getpracticehelp.com/data/?${MARK}`);
  mock(() => new Response('{}', { status: 500 }));
  assert.equal('page_pointer' in await callTool('practice_data_counts', { state: 'TX' }), false);
});
