import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TOOLS, callTool, serveTool, validateArgs, handleMcpRequest } from '../functions/mcp.js';
const read = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
// Synthetic P1 contract fixture, not a production observation.
const fixture = JSON.parse(read('ehr-product-detail.json'));
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const invoke = args => callTool('get_ehr_product_detail', args);
const body = result => JSON.parse(result.content[0].text);
const notFound = { schema_version: '1.0.0', error: 'product_not_found' };
function mock(data = fixture, status = 200) {
  const calls = [];
  globalThis.fetch = async (...args) => { calls.push(args); return Response.json(data, { status }); };
  return calls;
}
test('product tool is additive in discovery and catalogs', async () => {
  const listed = await handleMcpRequest({jsonrpc:'2.0',id:1,method:'tools/list'});
  assert.deepEqual(listed.result.tools, TOOLS);
  const spec = TOOLS.find(t => t.name === 'get_ehr_product_detail');
  assert.deepEqual(spec.inputSchema.required, ['product_key']);
  assert.equal(spec.annotations.readOnlyHint, true);
  const catalog = JSON.parse(readFileSync(new URL('../glama-release/tools.json', import.meta.url)));
  assert.deepEqual(catalog.find(t => t.name === spec.name), spec);
  const metadata = JSON.parse(readFileSync(new URL('../mcp.json', import.meta.url)));
  assert.ok(metadata.tools.includes(spec.name));
});
test('all existing definitions remain byte-identical and runtime-identical', () => {
  const s = readFileSync(new URL('../functions/mcp.js', import.meta.url), 'utf8');
  const start = s.indexOf('export const TOOLS = [');
  const block = s.slice(start, s.indexOf('\nconst PROMPTS', start)).replace('\n  EHR_PRODUCT_TOOL,', '');
  assert.equal(block, read('ehr-existing-tools-source.txt'));
  assert.deepEqual(TOOLS.filter(t => t.name !== 'get_ehr_product_detail'), JSON.parse(read('ehr-existing-tools.json')));
});
test('HTTP/MCP parity via served path, GET only, no credentials, bounded timeout', async () => {
  const calls = mock();
  const {result, cacheStatus} = await serveTool('get_ehr_product_detail', {product_key:'nextgen-healthcare'});
  assert.deepEqual(result, {content:[{type:'text',text:JSON.stringify(fixture)}]});
  assert.deepEqual(body(result), fixture);
  assert.equal(cacheStatus, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://www.getpracticehelp.com/api/ehr/products/nextgen-healthcare');
  const options = calls[0][1];
  assert.equal(options.method, 'GET');
  assert.equal(Object.hasOwn(options, 'credentials'), false);
  assert.equal(options.redirect, 'error');
  assert.equal(options.headers, undefined);
  assert.ok(options.signal instanceof AbortSignal);
});
test('product fetch init uses only Workers-supported options', async () => {
  const calls = mock();
  await invoke({product_key:'nextgen-healthcare'});
  assert.equal(calls.length, 1);
  const allowedKeys = new Set(['method', 'headers', 'redirect', 'signal', 'body', 'cf']);
  const unsupportedKeys = Reflect.ownKeys(calls[0][1]).filter(key => !allowedKeys.has(key));
  assert.deepEqual(unsupportedKeys, [], 'fetch init must use only Workers-supported options');
});

test('unknowns, null/absent open bounds and typed values survive unchanged', async () => {
  mock();
  const result = body(await invoke({product_key:'nextgen-healthcare'}));
  assert.deepEqual(result, fixture);
  assert.equal(result.product.facts[0].value_num_max, null);
  assert.equal(Object.hasOwn(result.product.facts[1], 'value_num_max'), false);
  assert.equal(result.product.facts[2].status, 'unknown');
  assert.equal(result.product.facts[3].status, 'vendor_does_not_publish');
  assert.equal(result.product.plans[0].eligible, null);
});
test('edition identity validates without filtering or inheritance', async () => {
  mock();
  for (const edition_key of ['office','enterprise']) {
    assert.deepEqual(body(await invoke({product_key:'nextgen-healthcare',edition_key})), fixture);
  }
});
test('unknown, empty and wrong-parent edition identities fail cleanly', async () => {
  for (const editions of [fixture.product.editions, [], [{edition_key:'office',product_key:'other'}]]) {
    mock({...fixture, product:{...fixture.product, editions}});
    const result = await invoke({product_key:'nextgen-healthcare',edition_key:editions === fixture.product.editions ? 'absent' : 'office'});
    assert.equal(result.isError, true);
    assert.deepEqual(body(result), notFound);
  }
});
test('invalid identities and aliases never fetch; validation matches execution', async () => {
  const calls = mock();
  for (const product_key of [undefined,null,1,{},[], '', ' ', 'NextGen', 'a/b','../a','a?b','a#b','a%2fb','Fixture alias']) {
    const args = {product_key};
    assert.deepEqual(body(validateArgs('get_ehr_product_detail', args)), notFound);
    assert.deepEqual(await invoke(args), validateArgs('get_ehr_product_detail', args));
  }
  for (const edition_key of [null,1,{},[], '', 'a/b']) {
    const args = {product_key:'nextgen-healthcare',edition_key};
    assert.deepEqual(body(await invoke(args)), notFound);
    assert.equal(validateArgs('get_ehr_product_detail',args).isError, true);
  }
  assert.equal(calls.length, 0);
});
test('extra arguments reject without fetching', async () => {
  const calls = mock();
  const args = {product_key:'nextgen-healthcare',guess:true};
  assert.equal(validateArgs('get_ehr_product_detail',args).isError, true);
  assert.equal((await invoke(args)).isError, true);
  assert.equal(calls.length, 0);
});
test('unknown product mirrors projection HTTP 404 JSON', async () => {
  mock(notFound,404);
  const result = await invoke({product_key:'absent'});
  assert.equal(result.isError, true);
  assert.deepEqual(body(result), notFound);
});
test('upstream errors, malformed JSON and timeout failures are clean tool errors', async () => {
  mock({error:'private-detail'},503);
  assert.deepEqual(body(await invoke({product_key:'nextgen-healthcare'})), {error:'product_upstream_error'});
  globalThis.fetch = async () => new Response('not JSON');
  assert.equal((await invoke({product_key:'nextgen-healthcare'})).isError, true);
  globalThis.fetch = async () => { throw new DOMException('timeout', 'TimeoutError'); };
  assert.deepEqual(body(await invoke({product_key:'nextgen-healthcare'})), {error:'product_upstream_unavailable'});
});
