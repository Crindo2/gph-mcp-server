// GPH-MCP-SERVING-01 / M1-SERVING-BUILD (C161 s.2 as amended by C161-A; GEN78 G78-35).
//
//   1. search_providers read cache: hit/miss, key normalization, TTL expiry, no stale serve past
//      the declared bound, faults never refuse a read.
//   2. Tool-description corrections, checked against the RENDERED get_provider_detail output.
//   3. Rate-control purpose: identical text in code and RUNBOOK.md.
//   4. traffic_class at write time, per call shape; D1 writer fallback before the migration.
//   5. Enumeration: a synthetic full-category walk (mocked upstream) completes with no refusal
//      below the existing infrastructure cap, `count` visible on every page.
//
//   node --test tests/serving-m1.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TOOLS, callTool, handleMcpRequest, classifyTrafficClass, buildTelemetry,
  searchCacheKey, fetchSearchData, SEARCH_CACHE_TTL_SECONDS,
  TELEMETRY_D1_BASE_COLUMNS, TELEMETRY_D1_M1_COLUMNS,
} from '../functions/mcp.js';

const source = readFileSync(new URL('../functions/mcp.js', import.meta.url), 'utf8');
const runbook = readFileSync(new URL('../RUNBOOK.md', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/2026_09_16_mcp_usage_log_traffic_class_cache_status.sql', import.meta.url), 'utf8');

// ---------------------------------------------------------------- fakes

// A Cache-API-shaped store that NEVER expires anything on its own -- so any TTL behaviour
// observed in these tests is the code's own enforcement, not the platform's.
function fakeCache() {
  const m = new Map();
  return {
    m,
    puts: 0,
    async match(req) { const v = m.get(req.url); return v ? new Response(v.body, { headers: v.headers }) : undefined; },
    async put(req, res) { this.puts++; m.set(req.url, { body: await res.text(), headers: Object.fromEntries(res.headers) }); },
  };
}

// Mocked /api/search over a synthetic category of `total` providers, 25 per page max.
function mockUpstream({ total = 3536, category = 'Laboratory & Diagnostics Services' } = {}) {
  const calls = [];
  const fetchFn = async (url) => {
    const u = new URL(String(url));
    calls.push(u);
    assert.equal(u.pathname, '/api/search', `unexpected upstream ${u}`);
    const perPage = Math.min(50, Math.max(1, parseInt(u.searchParams.get('per_page'), 10) || 20));
    const page = Math.max(1, parseInt(u.searchParams.get('page'), 10) || 1);
    const start = (page - 1) * perPage;
    const n = Math.max(0, Math.min(perPage, total - start));
    const providers = Array.from({ length: n }, (_, i) => ({
      slug: `lab-${start + i + 1}`, company_name: `Lab ${start + i + 1}`, category,
      city: 'Austin', state_abbr: 'TX', quality_score: 70, verified: 0, phone: '', website: '',
    }));
    return { ok: true, json: async () => ({ success: true, providers, pagination: { page, per_page: perPage, total, total_pages: Math.ceil(total / perPage) } }) };
  };
  return { calls, fetchFn };
}

async function withFetch(fetchFn, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fetchFn;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

async function quiet(fn) {
  const real = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = real; }
}

function fakeKV() {
  const m = new Map();
  return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); } };
}

function fakeD1({ hasM1Columns = true } = {}) {
  const rows = [];
  const statements = [];
  return {
    rows, statements,
    prepare(sql) {
      return {
        bind(...vals) {
          return {
            async run() {
              statements.push(sql);
              const cols = sql.match(/\(([^)]*)\)\s*VALUES/)[1].split(',').map(s => s.trim());
              if (!hasM1Columns) {
                const bad = cols.find(c => TELEMETRY_D1_M1_COLUMNS.includes(c));
                if (bad) throw new Error(`D1_ERROR: table mcp_usage_log has no column named ${bad}: SQLITE_ERROR`);
              }
              rows.push(Object.fromEntries(cols.map((c, i) => [c, vals[i]])));
              return { success: true };
            },
          };
        },
      };
    },
  };
}

function fakeRequest(ip = '203.0.113.7', ua = 'openai-mcp/1.0.0') {
  const h = new Headers({ 'cf-connecting-ip': ip, 'user-agent': ua });
  return { headers: h, cf: { country: 'US', asn: 8075, asOrganization: 'Microsoft Corporation' } };
}

function envWith({ cache = fakeCache(), db = fakeD1(), meter = fakeKV() } = {}) {
  return { __SEARCH_CACHE_FOR_TESTS: cache, TELEMETRY_DB: db, CALL_METER: meter };
}

async function mcpCall(env, request, name, args, id = 1) {
  const pending = [];
  const ctx = { request, waitUntil: p => pending.push(p) };
  const out = await handleMcpRequest({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, env, '', ctx);
  await Promise.all(pending);
  return out.result;
}

const LAB = 'Laboratory & Diagnostics Services';

// ---------------------------------------------------------------- 1. cache

test('cache: first read is a miss and stores; identical read is a hit with no upstream call', async () => {
  const cache = fakeCache();
  const up = mockUpstream();
  await withFetch(up.fetchFn, async () => {
    const t0 = 1_800_000_000_000;
    const a = await fetchSearchData({ category: LAB, per_page: 25, page: 3 }, { cache, now: t0 });
    assert.equal(a.cacheStatus, 'miss');
    assert.equal(up.calls.length, 1);
    assert.equal(cache.puts, 1);
    const b = await fetchSearchData({ category: LAB, per_page: 25, page: 3 }, { cache, now: t0 + 1000 });
    assert.equal(b.cacheStatus, 'hit');
    assert.equal(up.calls.length, 1, 'hit must not reach /api/search');
    assert.deepEqual(b.data, a.data, 'hit returns the stored upstream body unchanged');
    assert.equal(b.data.pagination.total, 3536);
  });
});

test('cache key: normalizes exactly what /api/search normalizes, and nothing it does not', () => {
  const k = searchCacheKey;
  // Same effective query -> same key.
  assert.equal(k({ category: LAB, state: 'tx' }), k({ category: LAB, state: 'TX' }));
  assert.equal(k({ category: LAB, city: 'San Antonio' }), k({ category: LAB, city: 'san-antonio' }));
  assert.equal(k({ category: LAB, tier1_grade: 'a' }), k({ category: LAB, tier1_grade: 'A' }));
  assert.equal(k({ category: LAB }), k({ category: LAB, page: 1, per_page: 10 }), 'defaults');
  assert.equal(k({ category: LAB, page: '2' }), k({ category: LAB, page: 2 }));
  assert.equal(k({ category: LAB, per_page: 40 }), k({ category: LAB, per_page: 25 }), 'row ceiling applied before keying');
  assert.equal(k({ category: LAB, min_rating: 0 }), k({ category: LAB }), 'min_rating 0 is not applied upstream');
  assert.equal(k({ category: LAB, state: '' }), k({ category: LAB }), 'empty filter is not sent');
  assert.equal(k({ page: 3, category: LAB, state: 'TX' }), k({ state: 'TX', category: LAB, page: 3 }), 'argument order');
  // Different effective query -> different key.
  assert.notEqual(k({ category: LAB, page: 2 }), k({ category: LAB, page: 3 }));
  assert.notEqual(k({ category: LAB, per_page: 10 }), k({ category: LAB, per_page: 25 }));
  for (const [f, v] of [['state', 'TX'], ['city', 'Austin'], ['min_rating', 50], ['tier1_grade', 'A'], ['practice_size_fit', 'Solo']]) {
    assert.notEqual(k({ category: LAB }), k({ category: LAB, [f]: v }), `filter ${f} must be part of the key`);
  }
  assert.notEqual(k({ category: LAB }), k({ category: 'Pharmacy & Medication Management' }));
  assert.notEqual(k({ category: LAB, city: 'Austin' }), k({ category: LAB, city: 'Dallas' }));
  assert.notEqual(k({ category: LAB, min_rating: 50 }), k({ category: LAB, min_rating: 60 }));
  assert.notEqual(k({ category: LAB, practice_size_fit: 'Solo' }), k({ category: LAB, practice_size_fit: 'Small' }));
  // Category is keyed verbatim: its alias resolver lives upstream and is not assumed here.
  assert.notEqual(k({ category: 'billing' }), k({ category: 'Billing' }));
});

test('cache TTL: an entry is served up to the bound and refetched at and after it', async () => {
  const cache = fakeCache();
  const up = mockUpstream();
  const ttlMs = SEARCH_CACHE_TTL_SECONDS * 1000;
  assert.equal(SEARCH_CACHE_TTL_SECONDS, 3600, 'declared TTL');
  await withFetch(up.fetchFn, async () => {
    const t0 = 1_800_000_000_000;
    await fetchSearchData({ category: LAB }, { cache, now: t0 });
    assert.equal((await fetchSearchData({ category: LAB }, { cache, now: t0 + ttlMs - 1 })).cacheStatus, 'hit');
    // The fake store never evicts, so this is the code's own bound.
    const atBound = await fetchSearchData({ category: LAB }, { cache, now: t0 + ttlMs });
    assert.equal(atBound.cacheStatus, 'miss');
    assert.equal(up.calls.length, 2);
    // The refetch re-stored with a new timestamp, so it is fresh again.
    assert.equal((await fetchSearchData({ category: LAB }, { cache, now: t0 + ttlMs + 5 })).cacheStatus, 'hit');
  });
});

test('cache: no stale serve after the bound -- a data change upstream is visible once the TTL passes', async () => {
  const cache = fakeCache();
  let total = 100;
  const fetchFn = async () => ({ ok: true, json: async () => ({ success: true, providers: [], pagination: { total } }) });
  await withFetch(fetchFn, async () => {
    const t0 = 1_800_000_000_000;
    assert.equal((await fetchSearchData({ category: LAB }, { cache, now: t0 })).data.pagination.total, 100);
    total = 101; // a D1 providers write lands (sync or any other writer)
    for (const dt of [1, 60_000, SEARCH_CACHE_TTL_SECONDS * 1000 - 1]) {
      assert.equal((await fetchSearchData({ category: LAB }, { cache, now: t0 + dt })).data.pagination.total, 100, 'within bound');
    }
    for (const dt of [SEARCH_CACHE_TTL_SECONDS * 1000, SEARCH_CACHE_TTL_SECONDS * 1000 * 24]) {
      assert.equal((await fetchSearchData({ category: LAB }, { cache, now: t0 + dt })).data.pagination.total, 101, 'past bound');
    }
  });
});

test('cache: entries with a missing, garbage or future timestamp are misses', async () => {
  const up = mockUpstream();
  await withFetch(up.fetchFn, async () => {
    const now = 1_800_000_000_000;
    for (const stamp of [null, 'garbage', String(now + 60_000)]) {
      const cache = fakeCache();
      const headers = { 'content-type': 'application/json' };
      if (stamp !== null) headers['x-gph-cached-at'] = stamp;
      cache.m.set(searchCacheKey({ category: LAB }), { body: JSON.stringify({ success: true, providers: [], pagination: { total: 1 } }), headers });
      assert.equal((await fetchSearchData({ category: LAB }, { cache, now })).cacheStatus, 'miss', `stamp ${stamp}`);
    }
  });
});

test('cache: failures are never stored; a throwing store serves uncached (bypass), never refuses', async () => {
  const cache = fakeCache();
  await withFetch(async () => ({ ok: false, json: async () => ({ success: false, error: 'boom' }) }), async () => {
    const r = await fetchSearchData({ category: LAB }, { cache, now: 1 });
    assert.equal(r.cacheStatus, 'miss');
    assert.equal(cache.puts, 0);
  });
  const broken = { async match() { throw new Error('cache down'); }, async put() { throw new Error('cache down'); } };
  const up = mockUpstream();
  await quiet(() => withFetch(up.fetchFn, async () => {
    const r = await fetchSearchData({ category: LAB }, { cache: broken, now: 1 });
    assert.equal(r.cacheStatus, 'bypass');
    assert.equal(r.data.pagination.total, 3536);
  }));
  const putOnlyBroken = { async match() { return undefined; }, async put() { throw new Error('write down'); } };
  await quiet(() => withFetch(up.fetchFn, async () => {
    const r = await fetchSearchData({ category: LAB }, { cache: putOnlyBroken, now: 1 });
    assert.equal(r.cacheStatus, 'miss');
    assert.ok(r.data.success);
  }));
});

test('cache via tools/call: a hit renders identically, still meters, still writes one telemetry row marked hit', async () => {
  const env = envWith();
  const up = mockUpstream();
  await withFetch(up.fetchFn, async () => {
    const req = fakeRequest();
    const first = await mcpCall(env, req, 'search_providers', { category: LAB, per_page: 25, page: 7 });
    const second = await mcpCall(env, req, 'search_providers', { category: LAB, per_page: 25, page: 7 });
    assert.deepEqual(second, first, 'identical tool result');
    assert.equal(second.count, 3536, 'count stays visible');
    assert.deepEqual(Object.keys(second).sort(), ['content', 'count', 'ids'], 'no new field in the result');
    assert.equal(up.calls.length, 1);
    const rows = env.TELEMETRY_DB.rows;
    assert.equal(rows.length, 2, 'every call is recorded');
    assert.deepEqual(rows.map(r => r.cache_status), ['miss', 'hit']);
    assert.deepEqual(rows.map(r => r.traffic_class), ['ingestion', 'ingestion']);
    const meterKey = [...env.CALL_METER.m.keys()].find(k => k.startsWith('ip_daily:203.0.113.7:'));
    assert.equal(env.CALL_METER.m.get(meterKey), '2', 'a hit still meters (safety valve unchanged)');
  });
});

test('cache is search_providers-only: other tools get cache_status NULL', async () => {
  const env = envWith();
  const fetchFn = async (url) => {
    if (String(url).endsWith('/categories')) return { ok: true, json: async () => ({ success: true, categories: [{ category: LAB, providers: 3536 }], total_providers: 3536 }) };
    return { ok: true, json: async () => ({ success: true, provider: { slug: 'lab-1', company_name: 'Lab 1', category: LAB } }) };
  };
  await withFetch(fetchFn, async () => {
    await mcpCall(env, fakeRequest(), 'list_categories', {});
    await mcpCall(env, fakeRequest(), 'get_provider_detail', { slug: 'lab-1' });
  });
  assert.deepEqual(env.TELEMETRY_DB.rows.map(r => r.cache_status), [null, null]);
  assert.equal(env.__SEARCH_CACHE_FOR_TESTS.puts, 0);
});

// ---------------------------------------------------------------- 2. descriptions

const FULL_ROW = {
  id: 1, slug: 'acme-labs-austin-tx', company_name: 'Acme Labs', category: LAB,
  super_category: 'Clinical Support', tier: 'paid', listing_tier: 'paid',
  reviews: [{ rating: 5, text: 'great' }], review_count: 12, average_rating: 4.8,
  city: 'Austin', state_abbr: 'TX', quality_score: 80, verified: 1,
  description: 'Legacy.', services_tags: 'a, b', practice_size_fit: 'Small',
  enriched_description: 'Enriched about text.', enriched_services_tags: '["PCR testing"]',
  enriched_certifications: '["CLIA"]', enriched_locations: '["Texas"]',
  enriched_practice_size_fit: 'Small', enriched_founding_year: 1999,
  extraction_confidence: 'high', extraction_grounded_in: 'site',
  phone: '512-555-0100', website: 'https://acme.example', google_rating: 4.6, google_review_count: 33,
};

async function renderDetail(row) {
  return withFetch(async () => ({ ok: true, json: async () => ({ success: true, provider: row }) }),
    () => callTool('get_provider_detail', { slug: row.slug })).then(o => o.content[0].text);
}

test('descriptions: get_provider_detail promises only what the rendered profile contains', async () => {
  const d = TOOLS.find(t => t.name === 'get_provider_detail').description;
  // The three removed promises are gone from the description ...
  for (const bad of [/super_category/, /listing tier/i, /review_count/, /average_rating/, /\breviews\b(?! count)/i, /free\/paid/]) {
    assert.ok(!bad.test(d), `description still promises ${bad}`);
  }
  // ... and are absent from the render even when the upstream body carries them.
  const text = await renderDetail(FULL_ROW);
  for (const absent of ['Clinical Support', 'paid', 'great', '4.8', 'Reviews:']) {
    assert.ok(!text.includes(absent), `render contains ${absent}`);
  }
  // Everything the description names is present in the render of a fully populated row.
  const promised = [
    ['company_name', '# Acme Labs'], ['category', `**Category:** ${LAB}`], ['city/state', 'Austin, TX'],
    ['quality_score', '**Profile Completeness:** 80/100'], ['verified status', 'Verified Listing'],
    ['description', 'Enriched about text.'], ['services offered', 'PCR testing'],
    ['practice_size_fit', '**Practice Size Fit:**'], ['phone', '512-555-0100'], ['website', 'https://acme.example'],
    ['Google rating and Google review count', '**Google Rating:** 4.6/5 (33 reviews)'],
    ['profile URL', 'https://www.getpracticehelp.com/providers/acme-labs-austin-tx/'],
    ['certifications and compliance attestations', 'CLIA'], ['locations served', 'Texas'],
    ['founding year', '**Founded:** 1999'], ['extraction confidence', 'high confidence'],
    ['what it was grounded in', 'sourced from vendor website'],
  ];
  for (const [phrase, marker] of promised) {
    assert.ok(d.includes(phrase), `description does not name "${phrase}"`);
    assert.ok(text.includes(marker), `render lacks ${marker} for "${phrase}"`);
  }
});

test('descriptions: city no longer claims partial matching; it names exact slug matching', () => {
  const city = TOOLS.find(t => t.name === 'search_providers').inputSchema.properties.city.description;
  assert.ok(!/partial match supported/i.test(city));
  assert.match(city, /exact city/);
  assert.match(city, /partial names and prefixes do not match/);
  // The key normalization is the same slug rule the description states.
  assert.equal(searchCacheKey({ category: LAB, city: 'San Antonio' }), searchCacheKey({ category: LAB, city: 'SAN  antonio' }));
});

test('descriptions: the glama snapshot carries the same two corrections', () => {
  const glama = JSON.parse(readFileSync(new URL('../glama-release/tools.json', import.meta.url), 'utf8'));
  const g = n => glama.find(t => t.name === n);
  assert.equal(g('get_provider_detail').description, TOOLS.find(t => t.name === 'get_provider_detail').description);
  assert.equal(g('search_providers').inputSchema.properties.city.description,
    TOOLS.find(t => t.name === 'search_providers').inputSchema.properties.city.description);
});

test('tools/list: page stays uncapped, count stays declared, per_page ceiling unchanged', () => {
  const sp = TOOLS.find(t => t.name === 'search_providers');
  assert.equal(sp.inputSchema.properties.page.maximum, undefined, 'no page cap');
  assert.equal(sp.inputSchema.properties.page.minimum, 1);
  assert.equal(sp.inputSchema.properties.per_page.maximum, 25);
  assert.ok(sp.outputSchema.properties.count);
  assert.equal(TOOLS.length, 4);
});

// ---------------------------------------------------------------- 3. rate-control purpose

function purposeBlock(text, begin, end, strip) {
  const i = text.indexOf(begin); const j = text.indexOf(end);
  assert.ok(i >= 0 && j > i, `purpose block markers present (${begin})`);
  return text.slice(i + begin.length, j).split('\n').map(strip).join(' ').replace(/\s+/g, ' ').trim();
}

test('rate-control purpose: the code comment and RUNBOOK.md carry the same text', () => {
  const inCode = purposeBlock(source, '// >>> RATE-CONTROL PURPOSE BEGIN >>>', '// <<< RATE-CONTROL PURPOSE END <<<', l => l.replace(/^\s*\/\/ ?/, ''));
  const inRunbook = purposeBlock(runbook, '<!-- >>> RATE-CONTROL PURPOSE BEGIN >>> -->', '<!-- <<< RATE-CONTROL PURPOSE END <<< -->', l => l);
  assert.equal(inCode, inRunbook);
  for (const must of ['infrastructure safety', 'pathological traffic', 'denial-of-service', 'resource exhaustion',
    'unexpected cost containment', 'NEVER an anti-enumeration product boundary', 'A legitimate agent must remain able to ingest a complete category']) {
    assert.ok(inCode.includes(must), `purpose text lacks "${must}"`);
  }
  // The purpose sits AT the metering code.
  assert.ok(source.indexOf('// <<< RATE-CONTROL PURPOSE END <<<') < source.indexOf('const DAILY_LIMIT = 100;'));
  assert.ok(source.indexOf('const DAILY_LIMIT = 100;') - source.indexOf('// <<< RATE-CONTROL PURPOSE END <<<') < 80);
});

test('rate controls: no ASN, organisation or category keyed limiter was introduced', () => {
  const meterKeys = [...source.matchAll(/`([a-z_]+):\$\{/g)].map(m => m[1]);
  assert.deepEqual([...new Set(meterKeys)].sort(), ['ip_daily', 'usage_retry'].sort(), `meter key prefixes: ${meterKeys}`);
  assert.ok(!/asn[^\n]*(limit|throttle|budget)|(limit|throttle|budget)[^\n]*\basn\b/i.test(source.replace(/\/\/[^\n]*/g, '')), 'no ASN-keyed control in code');
});

// ---------------------------------------------------------------- 4. traffic_class

test('traffic_class: each call shape classifies per the rule', () => {
  const c = classifyTrafficClass;
  // Ingestion: category-only pagination.
  assert.equal(c('search_providers', { category: LAB }), 'ingestion');
  assert.equal(c('search_providers', { category: LAB, page: 142, per_page: 25 }), 'ingestion');
  assert.equal(c('search_providers', { category: LAB, state: '', city: null, min_rating: 0 }), 'ingestion', 'unapplied filters are not context');
  // Demand: each contextual filter alone.
  for (const [k, v] of [['state', 'TX'], ['city', 'Austin'], ['min_rating', 60], ['tier1_grade', 'A'], ['practice_size_fit', 'Small']]) {
    assert.equal(c('search_providers', { category: LAB, page: 3, per_page: 25, [k]: v }), 'demand', k);
  }
  // Demand: drilldown and match/decision tool.
  assert.equal(c('get_provider_detail', { slug: 'x' }), 'demand');
  assert.equal(c('match_practice', { category: LAB, state: 'TX' }), 'demand');
  // Reference.
  assert.equal(c('list_categories', {}), 'reference');
  // Unknown tool.
  assert.equal(c('nope', {}), null);
});

test('traffic_class: written on the D1 row at write time; demand_cell and results_count unchanged', async () => {
  const req = fakeRequest();
  const rec = await buildTelemetry('gph', req, {}, 'search_providers', { category: LAB, page: 2, per_page: 25 }, 3536, 'anonymous', { surfaced: ['a'] }, 'hit');
  assert.equal(rec.traffic_class, 'ingestion');
  assert.equal(rec.cache_status, 'hit');
  assert.equal(rec.demand_cell, 'laboratory & diagnostics services|*|*|*');
  assert.equal(rec.results_count, 3536);
  assert.equal(rec.asn, 8075, 'ASN recorded as telemetry');
  assert.equal(rec.as_organization, 'Microsoft Corporation');
  const withState = await buildTelemetry('gph', req, {}, 'search_providers', { category: LAB, state: 'TX' }, 5, 'anonymous', null);
  assert.equal(withState.traffic_class, 'demand');
  assert.equal(withState.cache_status, null);
});

test('D1 writer: with the migration applied, the row carries traffic_class and cache_status', async () => {
  const env = envWith();
  await withFetch(mockUpstream().fetchFn, () => mcpCall(env, fakeRequest(), 'search_providers', { category: LAB, state: 'TX' }));
  const [row] = env.TELEMETRY_DB.rows;
  assert.equal(row.traffic_class, 'demand');
  assert.equal(row.cache_status, 'miss');
  for (const col of TELEMETRY_D1_BASE_COLUMNS) assert.ok(col in row, `base column ${col}`);
});

test('D1 writer: deployed BEFORE the migration, the call record is still written (pre-M1 columns)', async () => {
  const env = envWith({ db: fakeD1({ hasM1Columns: false }) });
  const out = await quiet(() => withFetch(mockUpstream().fetchFn, () => mcpCall(env, fakeRequest(), 'search_providers', { category: LAB })));
  assert.equal(out.count, 3536, 'the tool call itself is unaffected');
  assert.equal(env.TELEMETRY_DB.rows.length, 1, 'row written by the fallback');
  assert.ok(!('traffic_class' in env.TELEMETRY_DB.rows[0]));
  assert.equal(env.TELEMETRY_DB.rows[0].tool, 'search_providers');
});

test('migration: additive only (ADD COLUMN), both columns, marked not applied', () => {
  const stmts = migration.split('\n').filter(l => l.trim() && !l.trim().startsWith('--'));
  assert.deepEqual(stmts, [
    'ALTER TABLE mcp_usage_log ADD COLUMN traffic_class TEXT;',
    'ALTER TABLE mcp_usage_log ADD COLUMN cache_status TEXT;',
  ]);
  assert.match(migration, /STATUS: NOT APPLIED/);
  assert.ok(!/\b(DROP|RENAME|UPDATE|DELETE)\b/.test(stmts.join('\n')));
});

// ---------------------------------------------------------------- 5. enumeration

test('enumeration: a full 142-page category walk completes with no refusal and count on every page', async () => {
  // Lab: 3,536 providers / 25 = 142 pages. Two egress IPs (the real sweep fanned across 14-16),
  // each well under the existing 100/IP/day infrastructure cap.
  const env = envWith();
  const up = mockUpstream({ total: 3536 });
  const seen = new Set();
  await withFetch(up.fetchFn, async () => {
    for (let page = 1; page <= 142; page++) {
      const ip = page % 2 ? '198.51.100.1' : '198.51.100.2';
      const r = await mcpCall(env, fakeRequest(ip), 'search_providers', { category: LAB, per_page: 25, page }, page);
      assert.ok(!r.isError, `page ${page} refused: ${r.content?.[0]?.text}`);
      assert.equal(r.count, 3536, `count visible on page ${page}`);
      assert.match(r.content[0].text, new RegExp(`^3536 total results \\(page ${page}\\)`));
      r.ids.surfaced.forEach(s => seen.add(s));
    }
    assert.equal(seen.size, 3536, 'every provider in the category was reachable');
    assert.equal(up.calls.length, 142, 'first ingest: one upstream read per page, no more');

    // A repeat sweep (fresh IPs, same colo) is served from cache: cheaper, not slower or refused.
    for (let page = 1; page <= 142; page++) {
      const ip = page % 2 ? '198.51.100.3' : '198.51.100.4';
      const r = await mcpCall(env, fakeRequest(ip), 'search_providers', { category: LAB, per_page: 25, page }, 1000 + page);
      assert.ok(!r.isError);
      assert.equal(r.count, 3536);
    }
    assert.equal(up.calls.length, 142, 'repeat sweep made zero upstream reads');
  });
  const rows = env.TELEMETRY_DB.rows;
  assert.equal(rows.length, 284, 'every call telemetered');
  assert.equal(rows.filter(r => r.cache_status === 'hit').length, 142);
  assert.ok(rows.every(r => r.traffic_class === 'ingestion'));
});

test('enumeration: from ONE IP, no refusal occurs below the existing 100/day cap (cap itself unchanged)', async () => {
  const env = envWith();
  await withFetch(mockUpstream().fetchFn, async () => {
    for (let page = 1; page <= 100; page++) {
      const r = await mcpCall(env, fakeRequest('192.0.2.9'), 'search_providers', { category: LAB, per_page: 25, page }, page);
      assert.ok(!r.isError, `refused below cap at call ${page}`);
    }
    const over = await mcpCall(env, fakeRequest('192.0.2.9'), 'search_providers', { category: LAB, per_page: 25, page: 101 }, 101);
    assert.ok(over.isError, 'the pre-existing infrastructure cap still applies at call 101');
  });
});
