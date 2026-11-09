import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, callTool, validateArgs, handleMcpRequest } from '../functions/mcp.js';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const URL0 = 'https://www.getpracticehelp.com/data/api/counts';
const invoke = args => callTool('practice_data_counts', args);
const body = r => JSON.parse(r.content[0].text);
// Synthetic shape fixture, not a production observation.
const fixture = { schema_version: 1, as_of: '2026-11-04', unit: 'practices (headline evidence)', min_cell: 25,
  states: [{ state: 'TX', segments: [
    { segment_code: '01_PRIMARY_CARE_AND_PHYSICIAN', segment_slug: 'primary-care', label: 'Primary care', count: 120, suppressed: false },
    { segment_code: 'X', segment_slug: 'other', label: 'Other', count: null, suppressed: true }] }] };
function mock(data = fixture, status = 200) {
  const calls = [];
  globalThis.fetch = async (...a) => { calls.push(a); return Response.json(data, { status }); };
  return calls;
}
test('tools/list shows 6 tools including practice_data_counts', async () => {
  const listed = await handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(listed.result.tools.length, 6);
  const spec = listed.result.tools.find(t => t.name === 'practice_data_counts');
  assert.ok(spec);
  assert.equal(spec.inputSchema.additionalProperties, false);
  assert.equal(spec.inputSchema.properties.state.pattern, '^[A-Z]{2}$');
  assert.equal(TOOLS.length, 6);
});
test('no arguments: bare URL, GET, manual redirect, no credentials, timeout', async () => {
  const calls = mock();
  const r = await invoke({});
  assert.deepEqual(body(r), fixture);
  assert.equal(r.isError, undefined);
  assert.equal(calls[0][0], URL0);
  const o = calls[0][1];
  assert.equal(o.method, 'GET'); assert.equal(o.redirect, 'manual');
  assert.equal(Object.hasOwn(o, 'credentials'), false); assert.equal(o.headers, undefined);
  assert.ok(o.signal instanceof AbortSignal);
});
test('filters build the query', async () => {
  const calls = mock();
  await invoke({ state: 'TX', segment: 'primary-care' });
  await invoke({ state: 'CA' });
  await invoke({ segment: 'primary-care' });
  assert.deepEqual(calls.map(c => c[0]), [`${URL0}?state=TX&segment=primary-care`, `${URL0}?state=CA`, `${URL0}?segment=primary-care`]);
});
test('invalid arguments never fetch', async () => {
  const calls = mock();
  for (const args of [{ state: 'tx' }, { state: 'TEX' }, { state: 'T' }, { state: 1 }, { state: null }, { state: 'T1' },
    { segment: 'Primary Care' }, { segment: 1 }, { segment: '' }, { segment: 'a/b' }, { guess: true }, [], 'x']) {
    assert.equal(validateArgs('practice_data_counts', args).isError, true, JSON.stringify(args));
    const r = await invoke(args);
    assert.equal(r.isError, true);
    assert.deepEqual(body(r), { error: 'invalid_arguments' });
  }
  assert.equal(calls.length, 0);
  assert.equal(validateArgs('practice_data_counts', {}), null);
  assert.equal(validateArgs('practice_data_counts', { state: 'TX', segment: 'primary-care' }), null);
});
test('upstream 400, 500 and other non-200 map to tool errors, no count', async () => {
  for (const status of [400, 405, 500, 503, 301, 204]) {
    globalThis.fetch = async () => new Response(status === 301 || status === 204 ? null : JSON.stringify({ count: 999 }), { status });
    const r = await invoke({ state: 'TX' });
    assert.equal(r.isError, true, String(status));
    assert.deepEqual(body(r), { error: 'practice_data_counts_upstream_error', status });
  }
});
test('timeout, network failure and malformed JSON map to tool errors', async () => {
  globalThis.fetch = async () => { throw new DOMException('timeout', 'TimeoutError'); };
  let r = await invoke({});
  assert.equal(r.isError, true);
  assert.deepEqual(body(r), { error: 'practice_data_counts_upstream_unavailable' });
  globalThis.fetch = async () => { throw new TypeError('network'); };
  assert.equal((await invoke({})).isError, true);
  globalThis.fetch = async () => new Response('not JSON');
  assert.equal((await invoke({})).isError, true);
});
test('suppressed cell passes through as null, never 0', async () => {
  mock();
  const cell = body(await invoke({ state: 'TX' })).states[0].segments[1];
  assert.strictEqual(cell.count, null);
  assert.strictEqual(cell.suppressed, true);
});
const SIX = ['primary-care', 'dental', 'pt-ot-speech', 'specialty-clinics', 'behavioral-health', 'derm-peds-vision-podiatry'];
test('segment input schema is an enum of exactly the six slugs, in order', () => {
  const spec = TOOLS.find(t => t.name === 'practice_data_counts');
  assert.deepEqual(spec.inputSchema.properties.segment.enum, SIX);
  assert.equal(spec.inputSchema.properties.segment.pattern, undefined);
});
test('unknown segment is a tool error and nothing is fetched', async () => {
  for (const bad of ['unknown-slug', 'Primary-Care', '', 'primary-care ', 5]) {
    const calls = mock();
    const r = await invoke({ segment: bad });
    assert.equal(r.isError, true);
    assert.equal(calls.length, 0);
  }
});
test('each of the six slugs passes validation and is fetched', async () => {
  for (const slug of SIX) {
    const calls = mock();
    const r = await invoke({ segment: slug });
    assert.equal(r.isError, undefined);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], `${URL0}?segment=${slug}`);
  }
});
test('mcp.json, glama-release/tools.json and TOOLS name the same six tools', async () => {
  const { readFileSync } = await import('node:fs');
  const rd = p => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
  const names = TOOLS.map(t => t.name).sort();
  assert.equal(names.length, 6);
  assert.deepEqual(rd('mcp.json').tools.slice().sort(), names);
  assert.deepEqual(rd('glama-release/tools.json').map(t => t.name).sort(), names);
  const lc = TOOLS.find(t => t.name === 'list_categories');
  const gl = rd('glama-release/tools.json').find(t => t.name === 'list_categories');
  assert.equal(gl.description, lc.description);
  assert.equal(gl.title, lc.title);
});
test('description says exactly what is counted (C1490)', () => {
  const spec = TOOLS.find(t => t.name === 'practice_data_counts');
  assert.ok(spec.description.includes('headline'));
  assert.ok(spec.description.includes('lower-evidence'));
  assert.ok(spec.description.includes('507,423'));
  assert.ok(spec.description.includes('fewer than 25'));
});
// C1569 s.1: telemetry reads result.count; it must be the number of published, non-suppressed cells.
test('C1569: count is the number of published, non-suppressed cells; body unchanged', async () => {
  mock();
  const r = await invoke({ state: 'TX' });
  assert.strictEqual(r.count, 1);
  assert.deepEqual(body(r), fixture);
});
test('C1569: all cells suppressed or none returned gives count 0; telemetry zero_result is 1', async () => {
  const { buildTelemetry } = await import('../functions/mcp.js');
  const req = new Request('https://x/mcp', { headers: { 'user-agent': 'x' } });
  mock({ ...fixture, states: [{ state: 'TX', segments: [fixture.states[0].segments[1]] }] });
  let r = await invoke({});
  assert.strictEqual(r.count, 0);
  assert.equal((await buildTelemetry('gph', req, {}, 'practice_data_counts', {}, r.count, 'anonymous', r.ids)).zero_result, 1);
  mock({ ...fixture, states: [] });
  assert.strictEqual((await invoke({})).count, 0);
  mock();
  r = await invoke({});
  const t = await buildTelemetry('gph', req, {}, 'practice_data_counts', {}, r.count, 'anonymous', r.ids);
  assert.equal(t.results_count, 1);
  assert.equal(t.zero_result, 0);
});
test('C1569: errors carry no count and no citation', async () => {
  globalThis.fetch = async () => new Response('{}', { status: 500 });
  const r = await invoke({});
  assert.equal(r.isError, true);
  assert.equal(Object.hasOwn(r, 'count'), false);
  assert.equal(Object.hasOwn(r, 'source'), false);
});
// C1569 s.5: citation on every tool response.
test('C1569: practice_data_counts carries source and a UTM-tagged url; counts body untouched', async () => {
  mock();
  const r = await invoke({});
  assert.equal(r.source, 'GetPracticeHelp Practice Data');
  assert.equal(r.url, 'https://www.getpracticehelp.com/data/?utm_source=mcp&utm_medium=ai-assistant&utm_campaign=practice_data_counts');
  assert.deepEqual(JSON.parse(r.content[0].text), fixture);
  assert.equal(r.content.length, 2);
  assert.ok(r.content[1].text.includes(r.url));
});
test('C1569: directory tools carry source GetPracticeHelp and a matching tagged url', async () => {
  const { attributionFor } = await import('../functions/_shared/attribution.js');
  const q = n => `utm_source=mcp&utm_medium=ai-assistant&utm_campaign=${n}`;
  for (const [n, a, path] of [['list_categories', {}, '/providers/'], ['search_providers', { category: 'X' }, '/providers/'],
    ['match_practice', {}, '/match/'], ['get_provider_detail', { slug: 'acme-labs-austin-tx' }, '/providers/acme-labs-austin-tx/'],
    ['get_provider_detail', { slug: '../x' }, '/providers/'], ['get_ehr_product_detail', {}, '/providers/']]) {
    const r = attributionFor(n, a);
    assert.equal(r.source, 'GetPracticeHelp');
    assert.equal(r.url, `https://www.getpracticehelp.com${path}?${q(n)}`);
  }
});
test('C1569: list_categories result gains source and url through callTool', async () => {
  globalThis.fetch = async () => Response.json({ success: true, total_providers: 3, categories: [{ category: 'A', providers: 3 }] });
  const r = await callTool('list_categories', {});
  assert.equal(r.source, 'GetPracticeHelp');
  assert.ok(r.url.endsWith('utm_campaign=list_categories'));
  assert.equal(r.count, 1);
});
test('C1569: a suppressed cell is never counted, even if it carried a number', async () => {
  mock({ ...fixture, states: [{ state: 'TX', segments: [{ ...fixture.states[0].segments[0], suppressed: true }, fixture.states[0].segments[0]] }] });
  assert.strictEqual((await invoke({})).count, 1);
});
