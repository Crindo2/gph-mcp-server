// C2455: bad input gets isError with one plain sentence saying what was wrong and what to send;
// a valid query that matches nothing stays an ordinary empty result plus one line on how to widen.
// Every call here goes the way handleMcpRequest serves it: validateArgs first, then serveTool.
// Upstream is mocked; nothing here reaches the network or writes telemetry.
import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { validateArgs, serveTool } from '../functions/mcp.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

let calls = [];
function mock(route) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    const { status = 200, body } = route(String(url), init);
    return Response.json(body, { status });
  };
}
const SEEN = [];
async function run(tool, args) {
  const r = validateArgs(tool, args) || (await serveTool(tool, args)).result;
  for (const c of r.content || []) SEEN.push(c.text);
  return r;
}
// The plain sentence C2455 adds is always the last text block before any Source block.
const note = r => r.content.filter(c => !/^(\n\n)?Source: /.test(c.text)).at(-1).text;
const refused = (r, re) => {
  assert.equal(r.isError, true);
  assert.match(note(r), re);
  assert.equal(calls.length, 0, 'a refused call never reaches upstream');
};

const P = i => ({ slug: `fixture-${i}`, company_name: `Fixture ${i}`, category: 'Medical Billing & RCM', city: 'Austin', state_abbr: 'TX', quality_score: 75 });
const searchEmpty = () => ({ body: { success: true, providers: [], pagination: { total: 0 } } });
const matchEmpty = () => ({ body: { success: true, total: 0, matches: [] } });

// -- match_practice --
test('match_practice: a state that is not a US state is refused with one sentence', async () => {
  mock(matchEmpty);
  refused(await run('match_practice', { category: 'Medical Billing & RCM', state: 'Zxqvland' }), /^Zxqvland is not a US state\. Use a two-letter state code such as TX\.$/);
});
test('match_practice: US is refused and pointed at NATIONAL_OK', async () => {
  mock(matchEmpty);
  refused(await run('match_practice', { category: 'Medical Billing & RCM', state: 'US' }), /^US is the whole country rather than a state\. To search nationally, leave state out and set vendor_geo_preference to NATIONAL_OK\.$/);
});
test('match_practice: a two-letter code that is not a state is refused', async () => {
  mock(matchEmpty);
  refused(await run('match_practice', { category: 'Medical Billing & RCM', state: 'ZZ' }), /^ZZ is not a US state code\./);
});
test('match_practice: real codes in any case and full state names still run unchanged', async () => {
  for (const state of ['TX', 'tx', 'Texas', 'DC']) {
    mock(() => ({ body: { success: true, total: 1, matches: [P(1)] } }));
    const r = await run('match_practice', { category: 'Medical Billing & RCM', state });
    assert.equal(r.isError, undefined, state);
    assert.equal(calls.length, 1, state);
  }
});
test('match_practice: a category not in list_categories that matches nothing is an error', async () => {
  mock(matchEmpty);
  const r = await run('match_practice', { category: 'Dentistry', state: 'TX' });
  assert.equal(r.isError, true);
  assert.equal(r.count, 0);
  assert.equal(note(r), "No providers matched, and Dentistry isn't one of the directory's 25 category names. Call list_categories for the exact names, then search again with one of them.");
});
test('match_practice: an alias that matches nothing is not called unknown', async () => {
  mock(matchEmpty);
  const r = await run('match_practice', { category: 'billing', state: 'TX' });
  assert.equal(r.isError, undefined);
});
test('match_practice: an empty required argument is refused', async () => {
  mock(matchEmpty);
  refused(await run('match_practice', { category: '', state: 'TX' }), /requires `category`/);
});
test('match_practice: a valid query with no matches stays a result and says how to widen', async () => {
  mock(matchEmpty);
  const r = await run('match_practice', { category: 'Medical Billing & RCM', state: 'TX', city: 'Austin' });
  assert.equal(r.isError, undefined);
  assert.equal(r.count, 0);
  assert.match(r.content[0].text, /No matching providers/);
  assert.equal(note(r), 'Nothing matched with city set, so try again without it, starting with city.');
  mock(matchEmpty);
  const n = await run('match_practice', { category: 'Medical Billing & RCM', vendor_geo_preference: 'NATIONAL_OK' });
  assert.equal(note(n), 'Nothing matched even with national vendors allowed, so call list_categories and try a related category.');
});

// -- search_providers --
test('search_providers: a state that is not a US state is refused with one sentence', async () => {
  mock(searchEmpty);
  refused(await run('search_providers', { category: 'Medical Billing & RCM', state: 'Zxqvland' }), /^Zxqvland is not a US state\./);
});
test('search_providers: US is refused and told to leave state out', async () => {
  mock(searchEmpty);
  refused(await run('search_providers', { category: 'Medical Billing & RCM', state: 'US' }), /^US is the whole country rather than a state\. Leave state out to search every state/);
});
test('search_providers: a two-letter code that is not a state is refused', async () => {
  mock(searchEmpty);
  refused(await run('search_providers', { category: 'Medical Billing & RCM', state: 'QQ' }), /^QQ is not a US state code\./);
});
test('search_providers: a category not in list_categories that finds nothing is an error', async () => {
  mock(searchEmpty);
  const r = await run('search_providers', { category: 'Dentistry' });
  assert.equal(r.isError, true);
  assert.equal(r.count, 0);
  assert.match(note(r), /^No providers matched, and Dentistry isn't one of the directory's 25 category names\./);
});
test('search_providers: an empty required argument is refused', async () => {
  mock(searchEmpty);
  refused(await run('search_providers', { category: '   ' }), /requires `category`/);
});
test('search_providers: a valid query with no results stays a result and names the filters to drop', async () => {
  mock(searchEmpty);
  const r = await run('search_providers', { category: 'Medical Billing & RCM', state: 'TX', city: 'Austin', min_rating: 90 });
  assert.equal(r.isError, undefined);
  assert.equal(r.count, 0);
  assert.equal(r.content[0].text, '0 total results (page 1):\n\nNo providers found matching your criteria.');
  assert.equal(note(r), 'Nothing matched with city, min_rating and state set, so try again without one of them, starting with city.');
});
test('search_providers: a page past the last result says to go back to page 1', async () => {
  mock(() => ({ body: { success: true, providers: [], pagination: { total: 4 } } }));
  const r = await run('search_providers', { category: 'Medical Billing & RCM', page: 9 });
  assert.equal(r.isError, undefined);
  assert.equal(r.count, 4);
  assert.equal(note(r), 'This page is past the last result, since all 4 results fit on earlier pages, so ask for page 1.');
});
test('search_providers: results are unchanged when something matches', async () => {
  mock(() => ({ body: { success: true, providers: [P(1)], pagination: { total: 1 } } }));
  const r = await run('search_providers', { category: 'Medical Billing & RCM', state: 'TX' });
  assert.equal(r.content.length, 2); // results, then Source; no added sentence
});

// -- get_provider_detail --
test('get_provider_detail: a slug that does not exist is an error that says where slugs come from', async () => {
  mock(() => ({ status: 404, body: {} }));
  const r = await run('get_provider_detail', { slug: 'zxqv-no-such-firm' });
  assert.equal(r.isError, true);
  assert.equal(r.count, 0);
  assert.equal(r.content[0].text, 'Provider not found: zxqv-no-such-firm');
  assert.equal(note(r), 'No provider has the slug zxqv-no-such-firm. Slugs come from match_practice or search_providers results, so run one of those and pass a slug it returns.');
});
test('get_provider_detail: a 200 body with no provider reads the same as a missing slug', async () => {
  mock(() => ({ body: { success: false } }));
  const r = await run('get_provider_detail', { slug: 'gone' });
  assert.match(note(r), /^No provider has the slug gone\./);
});
test('get_provider_detail: an upstream failure says to retry, not to change the slug', async () => {
  mock(() => ({ status: 503, body: {} }));
  const r = await run('get_provider_detail', { slug: 'fixture-1' });
  assert.equal(r.isError, true);
  assert.match(note(r), /couldn't be loaded just now, so try get_provider_detail again/);
});
test('get_provider_detail: an empty slug is refused', async () => {
  mock(() => ({ body: {} }));
  refused(await run('get_provider_detail', { slug: '' }), /requires `slug`/);
});

// -- list_categories --
test('list_categories: an unknown argument is refused', async () => {
  mock(() => ({ body: { success: true, categories: [], total_providers: 0 } }));
  refused(await run('list_categories', { state: 'TX' }), /not a parameter/);
});
test('list_categories: an empty list stays a result and says to try again', async () => {
  mock(() => ({ body: { success: true, categories: [], total_providers: 0 } }));
  const r = await run('list_categories', {});
  assert.equal(r.isError, undefined);
  assert.equal(r.count, 0);
  assert.equal(note(r), 'The directory returned no categories just now, so try list_categories again in a minute.');
});

// -- get_ehr_product_detail --
const ehrMissing = () => ({ status: 404, body: { schema_version: '1.0.0', error: 'product_not_found' } });
const ehrBody = r => JSON.parse(r.content[0].text);
for (const key of ['test', 'zxqv-8812-nonexistent']) {
  test(`get_ehr_product_detail: product_key ${key} that does not exist keeps its JSON and adds a sentence`, async () => {
    mock(ehrMissing);
    const r = await run('get_ehr_product_detail', { product_key: key });
    assert.equal(r.isError, true);
    assert.deepEqual(ehrBody(r), { schema_version: '1.0.0', error: 'product_not_found' });
    assert.match(note(r), new RegExp(`^No EHR product has the key ${key}\\. Keys must match exactly and aliases aren't accepted\\.`));
  });
}
test('get_ehr_product_detail: a key that is not in key form is refused before any fetch', async () => {
  mock(ehrMissing);
  refused(await run('get_ehr_product_detail', { product_key: 'Epic Systems' }), /^Epic Systems is not a product key, because keys use only lowercase letters, numbers and hyphens/);
});
test('get_ehr_product_detail: an empty product_key is refused', async () => {
  mock(ehrMissing);
  refused(await run('get_ehr_product_detail', { product_key: '' }), /^get_ehr_product_detail needs a product_key/);
});
test('get_ehr_product_detail: an edition that is not under the product says to leave edition_key out', async () => {
  mock(() => ({ body: { product: { editions: [{ product_key: 'abc', edition_key: 'one' }] } } }));
  const r = await run('get_ehr_product_detail', { product_key: 'abc', edition_key: 'two' });
  assert.equal(r.isError, true);
  assert.equal(note(r), 'abc has no edition with the key two, so leave edition_key out to get the product with all its recorded editions.');
});

// -- practice_data_counts --
const counts = (segments = []) => ({ body: { schema_version: 1, as_of: '2026-11-04', unit: 'practices (headline evidence)', min_cell: 25, states: [{ state: 'TX', segments }] } });
const invalidBody = r => assert.deepEqual(JSON.parse(r.content[0].text), { error: 'invalid_arguments' });
test('practice_data_counts: a state that is not a US state is refused with one sentence', async () => {
  mock(counts);
  const r = await run('practice_data_counts', { state: 'Zxqvland' });
  refused(r, /^Zxqvland is not a US state\. Use a two-letter state code such as TX\.$/);
  invalidBody(r);
});
test('practice_data_counts: US is refused, where before it ran and came back empty', async () => {
  mock(counts);
  const r = await run('practice_data_counts', { state: 'US' });
  refused(r, /^US is the whole country rather than a state\. Leave state out to get counts for every state/);
  invalidBody(r);
});
test('practice_data_counts: lowercase codes and state names are refused with the code to send', async () => {
  mock(counts);
  refused(await run('practice_data_counts', { state: 'tx' }), /send TX rather than tx/);
  refused(await run('practice_data_counts', { state: 'Texas' }), /so send TX instead/);
});
test('practice_data_counts: a segment that does not exist lists the six', async () => {
  mock(counts);
  refused(await run('practice_data_counts', { segment: 'dentistry' }), /^dentistry is not one of the practice segments\. Send primary-care, dental/);
});
test('practice_data_counts: an empty state is refused', async () => {
  mock(counts);
  refused(await run('practice_data_counts', { state: '' }), /not a US state/);
});
test('practice_data_counts: a valid filter with nothing published stays a result and says how to widen', async () => {
  mock(() => counts([{ segment_code: 'X', segment_slug: 'dental', label: 'Dental', count: null, suppressed: true }]));
  const r = await run('practice_data_counts', { state: 'WY', segment: 'dental' });
  assert.equal(r.isError, undefined);
  assert.equal(r.count, 0);
  assert.equal(note(r), 'No published counts matched dental in WY. Cells with fewer than 25 practices are withheld, so try leaving out segment, or state, for a wider total.');
});
test('practice_data_counts: no filter and nothing published adds no sentence (nothing to widen)', async () => {
  mock(() => counts([]));
  const r = await run('practice_data_counts', {});
  assert.equal(r.content.length, 2); // body, then Source
});

// -- wording rules for every reply above --
after(() => {
  for (const t of SEEN) {
    assert.equal(/[^\x09\x0a\x0d\x20-\x7e]/.test(t), false, `non-ASCII in: ${t}`);
    assert.equal(/[\u2013\u2014]/.test(t), false, `en or em dash in: ${t}`);
  }
  assert.ok(SEEN.length > 40);
});
