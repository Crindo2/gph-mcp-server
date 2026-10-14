// C710 s.2: search_providers optional `name` argument (public vendor company_name lookup).
// Covers the MCP side: schema, guards, upstream pass-through, rendering, cache bypass, and the rule
// that the submitted name is never retained by any sink (D1 row, Airtable mirror, cache, KV, logs).
// Run with Node >=20:  node --test tests/name-lookup.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  TOOLS, validateArgs, searchUpstreamParams, fetchSearchData, handleMcpRequest, buildTelemetry,
  resetRateValveIsolateStateForTests,
} from '../functions/mcp.js';
import { checkNameArg, normalizeName, NAME_RESULT_CAP } from '../functions/_shared/name-lookup.js';

// Same literal is pinned in getpracticehelp's tests/search-name-lookup.test.mjs. Change both together.
const NAME_LOOKUP_SHA256 = '514c6ce691f068c336ca117efaf73aa9c93fddb7574ad0a8a8569eee809cf105';
const CANARY = 'Zq-Canaryvendor LLC';
const CANARY_FRAGMENTS = ['canaryvendor', 'zq-canary', 'Zq Canary'];

const spec = TOOLS.find(t => t.name === 'search_providers');

function provider(i, over = {}) {
  return { slug: `canary-${i}`, company_name: `Zq Canaryvendor ${i}`, category: 'Medical Billing & RCM', city: 'Austin', state_abbr: 'TX', quality_score: 70, phone: '', website: '', ...over };
}

function setup({ providers = [provider(1)], capped = false, failStatus = null } = {}) {
  const captured = { upstream: [], airtable: [], errors: [], cachePuts: [], kv: [] };
  const fetchFn = async (url, init) => {
    const u = String(url);
    if (u.includes('api.airtable.com')) { captured.airtable.push(String(init && init.body)); return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' }; }
    captured.upstream.push(u);
    if (failStatus) return { ok: false, status: failStatus, json: async () => ({ success: false, error: '`name` must contain at least one letter or digit' }) };
    return { ok: true, json: async () => ({ success: true, providers, pagination: { page: 1, per_page: 25, total: providers.length, total_pages: 1, capped } }) };
  };
  const rows = [];
  const db = {
    prepare(sql) {
      return { bind(...vals) { return { async run() { const cols = sql.match(/\(([^)]*)\)\s*VALUES/)[1].split(',').map(s => s.trim()); rows.push(Object.fromEntries(cols.map((c, i) => [c, vals[i]]))); return { success: true }; } }; } };
    },
  };
  const cache = { async match() { return null; }, async put(req, res) { captured.cachePuts.push(req.url + ' ' + await res.text()); } };
  const m = new Map();
  const meter = { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { captured.kv.push(`${k}=${v}`); m.set(k, v); } };
  resetRateValveIsolateStateForTests();
  let t = 1_800_000_000_000;
  const env = { __SEARCH_CACHE_FOR_TESTS: cache, TELEMETRY_DB: db, CALL_METER: meter, AIRTABLE_PAT: 'pat-test', __CLOCK_FOR_TESTS: () => (t += 1100) };
  return { env, captured, rows, fetchFn };
}

const request = () => ({ headers: new Headers({ 'cf-connecting-ip': '203.0.113.9', 'user-agent': 'Claude-User' }), cf: { country: 'US' } });

async function mcp(s, args, name = 'search_providers') {
  const real = { fetch: globalThis.fetch, error: console.error, log: console.log, warn: console.warn };
  const sink = (...a) => s.captured.errors.push(a.map(String).join(' '));
  globalThis.fetch = s.fetchFn; console.error = sink; console.log = sink; console.warn = sink;
  try {
    const pending = [];
    const ctx = { request: request(), waitUntil: p => pending.push(p) };
    const out = await handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, s.env, '', ctx);
    await Promise.all(pending);
    return out.result;
  } finally { Object.assign(globalThis, { fetch: real.fetch }); console.error = real.error; console.log = real.log; console.warn = real.warn; }
}

// Everything a sink could have retained, EXCLUDING the upstream search URL (which must carry the name).
function retained(s) {
  return JSON.stringify([s.rows, s.captured.airtable, s.captured.errors, s.captured.cachePuts, s.captured.kv]);
}
function assertNoName(s, label) {
  const dump = retained(s).toLowerCase();
  for (const f of CANARY_FRAGMENTS) assert.ok(!dump.includes(f.toLowerCase()), `${label}: retained state must not contain "${f}"`);
}

test('shared normalizer file is the pinned byte-identical copy', () => {
  const sha = createHash('sha256').update(readFileSync(new URL('../functions/_shared/name-lookup.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')).digest('hex'); // line-ending neutral
  assert.equal(sha, NAME_LOOKUP_SHA256);
});

test('schema: optional name (max 100), category no longer unconditionally required', () => {
  const p = spec.inputSchema.properties.name;
  assert.equal(p.type, 'string');
  assert.equal(p.maxLength, 100);
  assert.match(p.description, /never stored/);
  assert.match(spec.description, /pass `name`/);
  assert.deepEqual(spec.inputSchema.required, []);
  assert.equal(NAME_RESULT_CAP, 25);
});

test('validation: name-only is accepted; category still required without a name', () => {
  assert.equal(validateArgs('search_providers', { name: 'Revive' }), null);
  assert.equal(validateArgs('search_providers', { name: 'Revive', state: 'TX', category: 'EHR' }), null);
  const missing = validateArgs('search_providers', { state: 'TX' });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /requires `category`/);
});

test('validation: >100 chars, email, phone, NPI, blank, punctuation-only, non-string are refused without echo', () => {
  const bad = ['x'.repeat(101), 'bob@example.com', '(214) 555-0187', '1234567890', ' ', '!!! ---', 12345, ['a']];
  for (const n of bad) {
    const r = validateArgs('search_providers', { name: n });
    assert.ok(r && r.isError, `name=${JSON.stringify(n)} must be refused`);
    if (typeof n === 'string' && n.trim()) assert.ok(!r.content[0].text.includes(n), 'error text must not echo the name');
  }
  assert.equal(validateArgs('search_providers', { name: 'x'.repeat(100) }), null);
  assert.equal(validateArgs('search_providers', { name: 'A+ Billing 24/7' }), null);
  assert.equal(validateArgs('search_providers', { name: 'Revive' }), null);
});

test('name guard is scoped: other tools still reject an unknown `name`, get_provider_detail untouched', () => {
  assert.match(validateArgs('get_provider_detail', { slug: 'a', name: 'x' }).content[0].text, /unrecognized argument/);
  assert.match(validateArgs('match_practice', { category: 'EHR', state: 'TX', name: 'x' }).content[0].text, /unrecognized argument/);
});

test('upstream: name is forwarded alone and combined with every existing filter', () => {
  assert.equal(searchUpstreamParams({ name: 'Revive' }).get('name'), 'Revive');
  const p = searchUpstreamParams({ name: 'Revive', category: 'EHR', state: 'TX', city: 'Austin', min_rating: 50, tier1_grade: 'A', practice_size_fit: 'Small' });
  for (const [k, v] of Object.entries({ name: 'Revive', category: 'EHR', state: 'TX', city: 'Austin', min_rating: '50', tier1_grade: 'A', practice_size_fit: 'Small' })) assert.equal(p.get(k), v);
  assert.equal(searchUpstreamParams({ category: 'EHR' }).has('name'), false);
});

test('served name lookup: slug rendered, up to 25 in one page, structured ids, upstream call carries the name', async () => {
  const many = Array.from({ length: 25 }, (_, i) => provider(i + 1));
  const s = setup({ providers: many, capped: true });
  const r = await mcp(s, { name: CANARY });
  assert.equal(s.captured.upstream.length, 1);
  assert.ok(new URL(s.captured.upstream[0]).searchParams.get('name') === CANARY);
  assert.equal(r.count, 25);
  assert.equal(r.ids.surfaced.length, 25);
  assert.match(r.content[0].text, /Slug: canary-1\n/);
  assert.match(r.content[0].text, /More than 25 vendors match this name/);
});

test('name+filters through the served path: filters ride the same upstream call', async () => {
  const s = setup();
  await mcp(s, { name: 'Canaryvendor', state: 'TX', category: 'Medical Billing & RCM' });
  const q = new URL(s.captured.upstream[0]).searchParams;
  assert.equal(q.get('state'), 'TX');
  assert.equal(q.get('category'), 'Medical Billing & RCM');
});

test('no match: honest empty answer, counted as a reference lookup not a zero_result', async () => {
  const s = setup({ providers: [] });
  const r = await mcp(s, { name: 'Nobody Here' });
  assert.match(r.content[0].text, /^0 vendors matching that name/);
  assert.equal(s.rows[0].results_count, 0);
  assert.equal(s.rows[0].zero_result, 0);
  assert.equal(s.rows[0].funnel_step, 'reference');
});

test('cache bypass: a name lookup never reads or writes the search cache', async () => {
  const s = setup();
  const r = await mcp(s, { name: CANARY });
  assert.equal(s.captured.cachePuts.length, 0);
  assert.equal(s.rows[0].cache_status, 'bypass');
  assert.ok(!r.isError);
  const direct = await fetchSearchData({ name: CANARY }, { cache: { async match() { throw new Error('cache must not be consulted'); }, async put() { throw new Error('cache must not be written'); } } });
  assert.equal(direct.cacheStatus, 'bypass');
});

test('TELEMETRY: the submitted name reaches no sink; row carries slugs + count as its own dimension', async () => {
  const s = setup({ providers: [provider(1), provider(2)] });
  await mcp(s, { name: CANARY, state: 'TX', category: 'Medical Billing & RCM' });
  assert.equal(s.rows.length, 1);
  const row = s.rows[0];
  assert.deepEqual(JSON.parse(row.raw_args), { dimension: 'name_lookup', matched_slugs: ['canary-1', 'canary-2'], count: 2 });
  assert.equal(row.search_term, null);
  assert.equal(row.demand_cell, null);
  assert.equal(row.category, null);
  assert.equal(row.state, null);
  assert.equal(row.field_completeness, null);
  assert.equal(row.tool, 'search_providers');
  assert.equal(row.funnel_step, 'reference');
  assert.equal(row.traffic_class, 'reference');
  assert.equal(JSON.parse(row.vendor_surfaced).length, 2);
  assert.ok(s.captured.airtable.length >= 1, 'the Airtable mirror must have been exercised');
  assertNoName(s, 'served');
});

test('TELEMETRY: refused name lookups (guard + rate valve) also retain no name', async () => {
  const s = setup();
  const r = await mcp(s, { name: CANARY + ' bob@example.com' });
  assert.equal(r.isError, true);
  assert.equal(s.captured.upstream.length, 0, 'a refused name is never sent upstream');
  assertNoName(s, 'refused');
  const row = s.rows[0];
  assert.equal(row.search_term, null);
  assert.equal(JSON.parse(row.raw_args).dimension, 'name_lookup');
  const rec = await buildTelemetry('gph', request(), {}, 'search_providers', { name: CANARY, category: 'EHR' }, null, 'anonymous', null, null);
  assert.ok(!JSON.stringify(rec).toLowerCase().includes('canaryvendor'));
});

test('TELEMETRY regression: ordinary category search still logs category demand exactly as before', async () => {
  const s = setup();
  await mcp(s, { category: 'Medical Billing & RCM', state: 'TX' });
  const row = s.rows[0];
  assert.equal(row.category, 'Medical Billing & RCM');
  assert.equal(row.state, 'TX');
  assert.equal(row.traffic_class, 'demand');
  assert.equal(row.funnel_step, 'discover');
  assert.deepEqual(JSON.parse(row.raw_args), { category: 'Medical Billing & RCM', state: 'TX' });
  assert.notEqual(row.demand_cell, null);
});

test('upstream error is surfaced without the name', async () => {
  const s = setup({ failStatus: 400 });
  const r = await mcp(s, { name: 'ok name' });
  assert.equal(r.isError, true);
  assert.ok(!r.content[0].text.includes('ok name'));
});

test('normalizer parity: case/punctuation/accents fold the same way the API does', () => {
  assert.equal(normalizeName('  Revive-RCM, Inc. '), normalizeName('revive rcm inc'));
  assert.equal(normalizeName('Café Billing'), 'cafebilling');
  assert.equal(checkNameArg('Revive').normalized, 'revive');
});
