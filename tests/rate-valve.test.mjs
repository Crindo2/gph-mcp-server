// GPH-MCP-RATE-VALVE-01 / R1-VALVE-BUILD (C164 s.1(b), correcting C163 s.2; C161-A s.3; GEN78 G78-52).
//
// The anonymous per-IP daily TOTAL cap (100/day) is replaced by a request-RATE safety valve with a
// daily backstop above a full-corpus ingest. Every behavioural test here drives the REAL handler
// (handleMcpRequest -> checkAccess -> checkRateValve -> serveTool) against a KV fake that enforces
// the Workers KV constraints the valve has to live with: at most 1 write per second per key (more
// throws a 429), expirationTtl >= 60 s, expiry on the injected clock. Nothing below restates the
// valve's arithmetic in order to agree with it (C163 s.3).
//
//   node --test tests/rate-valve.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  handleMcpRequest, resetRateValveIsolateStateForTests,
  RATE_WINDOW_SECONDS, RATE_LIMIT_PER_WINDOW, DAILY_BACKSTOP,
} from '../functions/mcp.js';

const source = readFileSync(new URL('../functions/mcp.js', import.meta.url), 'utf8');
const runbook = readFileSync(new URL('../RUNBOOK.md', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

// Live corpus, read once from https://www.getpracticehelp.com/api/categories on 2026-09-16
// (25 categories, total_providers 74,993). A fixture for sizing, not a contract: the test
// asserts the valve admits THIS corpus, and the runbook states how to re-derive it.
const CORPUS = {
  'Healthcare Legal Services': 7380, 'Medical Billing & RCM': 7136,
  'Healthcare Insurance & Malpractice Brokers': 6609, 'Healthcare Signage & Wayfinding': 4410,
  'Healthcare Real Estate & Site Selection': 4271, 'Healthcare IT & EHR': 3924,
  'Healthcare Marketing & Reputation Management': 3721, 'Laboratory & Diagnostics Services': 3536,
  'Healthcare PR & Communications': 3524, 'Medical Equipment & Supplies': 3395,
  'Healthcare Staffing & Recruiting': 3365, 'Practice Valuation & Brokerage': 3056,
  'Practice Management Consulting': 2782, 'Practice Financing & Loans': 2644,
  'Compliance & HIPAA Services': 2593, 'Healthcare Construction & Facilities': 2563,
  'Pharmacy & Medication Management': 2282, 'Telehealth & Virtual Care Infrastructure': 2221,
  'Medical Transcription & Documentation': 1231, 'Medical Coding Services': 1189,
  'Patient Financing & Payment Solutions': 1113, 'Credentialing Services': 1022,
  'Medical Waste & Environmental Services': 975, 'Healthcare CPA & Tax Advisory': 49,
  'Group Purchasing Organizations (GPOs)': 2,
};
const PER_PAGE = 25;
const T0 = Date.UTC(2026, 8, 17, 9, 0, 0) + 12_345; // off a window boundary on purpose

// ---------------------------------------------------------------- fakes

class KvRateLimited extends Error { constructor(k) { super(`KV PUT failed: 429 Too Many Requests (key ${k})`); } }

// Workers KV as the valve meets it: 1 write/s per key, TTL >= 60 s, expiry on the test clock.
function realisticKV(clock) {
  const m = new Map();
  const lastPut = new Map();
  const kv = {
    m, puts: 0, rejectedPuts: 0,
    async get(k) {
      const v = m.get(k);
      if (!v) return null;
      if (clock() >= v.exp) return null;
      return v.value;
    },
    async put(k, value, opts = {}) {
      const now = clock();
      if (opts.expirationTtl !== undefined && opts.expirationTtl < 60) throw new Error('KV PUT failed: 400 expiration_ttl must be at least 60');
      if (lastPut.has(k) && now - lastPut.get(k) < 1000) { kv.rejectedPuts++; throw new KvRateLimited(k); }
      lastPut.set(k, now);
      kv.puts++;
      m.set(k, { value: String(value), exp: opts.expirationTtl ? now + opts.expirationTtl * 1000 : Infinity });
    },
  };
  return kv;
}

function fakeD1() {
  const rows = [];
  return {
    rows,
    prepare(sql) {
      return { bind(...vals) { return { async run() {
        const cols = sql.match(/\(([^)]*)\)\s*VALUES/)[1].split(',').map(s => s.trim());
        rows.push(Object.fromEntries(cols.map((c, i) => [c, vals[i]])));
        return { success: true };
      } }; } };
    },
  };
}

function passthroughCache() {
  return { async match() { return undefined; }, async put() {} };
}

function corpusUpstream() {
  const calls = { search: 0, categories: 0, airtable: 0 };
  const fetchFn = async (url) => {
    const u = new URL(String(url));
    if (u.hostname === 'api.airtable.com') { calls.airtable++; return { ok: true, text: async () => '' }; }
    if (u.pathname === '/api/categories') {
      calls.categories++;
      const categories = Object.entries(CORPUS).map(([category, providers]) => ({ category, providers }));
      return { ok: true, json: async () => ({ success: true, categories, total_providers: 74993 }) };
    }
    assert.equal(u.pathname, '/api/search', `unexpected upstream ${u}`);
    calls.search++;
    const category = u.searchParams.get('category');
    const total = CORPUS[category] ?? 0;
    const perPage = Math.min(50, Math.max(1, parseInt(u.searchParams.get('per_page')) || 20));
    const page = Math.max(1, parseInt(u.searchParams.get('page')) || 1);
    const start = (page - 1) * perPage;
    const n = Math.max(0, Math.min(perPage, total - start));
    const providers = Array.from({ length: n }, (_, i) => ({ slug: `${category}#${start + i + 1}`, company_name: `P${start + i + 1}`, category }));
    return { ok: true, json: async () => ({ success: true, providers, pagination: { page, per_page: perPage, total, total_pages: Math.ceil(total / perPage) } }) };
  };
  return { calls, fetchFn };
}

function harness({ start = T0 } = {}) {
  resetRateValveIsolateStateForTests();
  let now = start;
  const clock = () => now;
  const env = {
    CALL_METER: realisticKV(clock), TELEMETRY_DB: fakeD1(), AIRTABLE_PAT: 'test-not-a-secret',
    __SEARCH_CACHE_FOR_TESTS: passthroughCache(), __CLOCK_FOR_TESTS: clock,
  };
  const up = corpusUpstream();
  let id = 0;
  async function call(ip, name, args, { apiKey = '' } = {}) {
    const pending = [];
    const request = { headers: new Headers({ 'cf-connecting-ip': ip, 'user-agent': 'cbeg-rate-valve-test' }), cf: {} };
    const out = await handleMcpRequest({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } },
      env, apiKey, { request, waitUntil: p => pending.push(p) });
    await Promise.all(pending);
    return out.result;
  }
  return { env, up, call, advance: ms => { now += ms; }, now: () => now };
}

async function withFetch(fetchFn, fn) {
  const real = globalThis.fetch; const realErr = console.error;
  globalThis.fetch = fetchFn; console.error = () => {};
  try { return await fn(); } finally { globalThis.fetch = real; console.error = realErr; }
}

const isRefusal = r => r.isError === true && /^Rate limit exceeded/.test(r.content[0].text);

// ---------------------------------------------------------------- sizing

test('sizing: the corpus is 3,010 pages / 3,011 calls; the valve admits it in ~25 minutes; the backstop has headroom', () => {
  const pages = Object.values(CORPUS).reduce((n, c) => n + Math.ceil(c / PER_PAGE), 0);
  const providers = Object.values(CORPUS).reduce((n, c) => n + c, 0);
  assert.equal(Object.keys(CORPUS).length, 25);
  assert.equal(providers, 74993);
  assert.equal(pages, 3010);
  const calls = pages + 1; // + list_categories
  const perMinute = RATE_LIMIT_PER_WINDOW * 60 / RATE_WINDOW_SECONDS;
  assert.equal(perMinute, 120);
  assert.equal(Math.round(calls / perMinute * 10) / 10, 25.1, 'minutes from one egress at the ceiling');
  assert.ok(DAILY_BACKSTOP >= 6 * calls, `backstop ${DAILY_BACKSTOP} vs full-corpus ${calls}`);
  assert.ok(DAILY_BACKSTOP >= 3 * 2 * calls, 'still 3x if the corpus doubled');
  // Old cap, for the record: 100/day would take 31 days for the same walk.
  assert.equal(Math.ceil(calls / 100), 31);
});

// ---------------------------------------------------------------- full-corpus walk

async function fullCorpusWalk(h, ip, { stepMs, isolateRecycleEvery = 0 }) {
  const seen = new Set();
  let n = 0;
  const tick = () => { n++; if (isolateRecycleEvery && n % isolateRecycleEvery === 0) resetRateValveIsolateStateForTests(); h.advance(stepMs); };
  const cats = await h.call(ip, 'list_categories', {});
  assert.ok(!cats.isError, `list_categories refused: ${cats.content[0].text}`);
  assert.equal(cats.count, 25);
  tick();
  for (const [category, total] of Object.entries(CORPUS)) {
    const pages = Math.ceil(total / PER_PAGE);
    for (let page = 1; page <= pages; page++) {
      const r = await h.call(ip, 'search_providers', { category, per_page: PER_PAGE, page });
      assert.ok(!r.isError, `REFUSED at call ${n + 1} (${category} p${page}): ${r.content[0].text}`);
      assert.equal(r.count, total, 'count visible on every page');
      r.ids.surfaced.forEach(s => seen.add(s));
      tick();
    }
  }
  return { seen, calls: n };
}

test('full corpus: ONE IP at exactly the permitted rate (120 per 60 s) walks every page of every category and is never refused', async () => {
  const h = harness();
  const stepMs = (RATE_WINDOW_SECONDS * 1000) / RATE_LIMIT_PER_WINDOW; // 500 ms
  await withFetch(h.up.fetchFn, async () => {
    const t = h.now();
    const { seen, calls } = await fullCorpusWalk(h, '198.51.100.77', { stepMs });
    assert.equal(calls, 3011);
    assert.equal(seen.size, 74993, 'every public provider reached');
    assert.equal(h.up.calls.search, 3010);
    assert.equal(Math.round((h.now() - t) / 60000 * 10) / 10, 25.1, 'elapsed simulated minutes');
  });
  assert.equal(h.env.TELEMETRY_DB.rows.filter(r => r.traffic_class === 'pathological_rate').length, 0);
  // The meter really counted: the daily key reached the walk size (not a counter that cannot rise),
  // and the valve never collided with KV's 1-write-per-second-per-key limit.
  const day = [...h.env.CALL_METER.m.entries()].find(([k]) => k.startsWith('ip_daily:198.51.100.77:'));
  assert.ok(Number(day[1].value) >= 3011 - 2, `daily meter ${day[1].value}`);
  assert.equal(h.env.CALL_METER.rejectedPuts, 0);
});

test('full corpus: the same walk survives isolate recycling every 37 calls (local state lost) without refusal', async () => {
  const h = harness();
  await withFetch(h.up.fetchFn, async () => {
    const { seen } = await fullCorpusWalk(h, '198.51.100.78', { stepMs: 500, isolateRecycleEvery: 37 });
    assert.equal(seen.size, 74993);
  });
});

// ---------------------------------------------------------------- burst

test('burst: 100 calls/s from one IP is refused after the window allowance, with retry-after, and recovers after it', async () => {
  const h = harness();
  const results = [];
  await withFetch(h.up.fetchFn, async () => {
    for (let i = 0; i < 600; i++) {
      results.push(await h.call('203.0.113.66', 'search_providers', { category: 'Medical Billing & RCM', per_page: 25, page: (i % 286) + 1 }));
      h.advance(10);
    }
  });
  const allowed = results.filter(r => !r.isError).length;
  const refused = results.filter(isRefusal);
  assert.equal(allowed, RATE_LIMIT_PER_WINDOW, 'exactly the window allowance is served inside one window (single isolate)');
  assert.equal(refused.length, 600 - RATE_LIMIT_PER_WINDOW);
  assert.equal(h.up.calls.search, RATE_LIMIT_PER_WINDOW, 'refused calls never reach /api/search');
  for (const r of refused) {
    assert.ok(Number.isInteger(r.retry_after_seconds) && r.retry_after_seconds >= 1 && r.retry_after_seconds <= RATE_WINDOW_SECONDS);
    assert.match(r.content[0].text, new RegExp(`Retry after ${r.retry_after_seconds} seconds`));
  }
  // KV counter actually rose to the limit without a single 429 from KV.
  const rateEntry = [...h.env.CALL_METER.m.entries()].find(([k]) => k.startsWith('ip_rate:203.0.113.66:'));
  assert.ok(Number(rateEntry[1].value) >= 100, `KV rate counter ${rateEntry[1].value}`);
  assert.equal(h.env.CALL_METER.rejectedPuts, 0);
  // Telemetry: exactly one pathological_rate row for the flood, no Airtable POST for refusals.
  const patho = h.env.TELEMETRY_DB.rows.filter(r => r.traffic_class === 'pathological_rate');
  assert.equal(patho.length, 1);
  assert.equal(patho[0].tool, 'search_providers');
  assert.equal(h.env.TELEMETRY_DB.rows.length, RATE_LIMIT_PER_WINDOW + 1);
  assert.equal(h.up.calls.airtable, RATE_LIMIT_PER_WINDOW);
  // Honour retry-after and the next call is served.
  h.advance(refused.at(-1).retry_after_seconds * 1000);
  await withFetch(h.up.fetchFn, async () => {
    const r = await h.call('203.0.113.66', 'search_providers', { category: 'Medical Billing & RCM', per_page: 25, page: 1 });
    assert.ok(!r.isError, r.content[0].text);
  });
});

test('burst: the valve is per IP -- a flood from one IP does not refuse another IP', async () => {
  const h = harness();
  await withFetch(h.up.fetchFn, async () => {
    for (let i = 0; i < 200; i++) await h.call('203.0.113.1', 'list_categories', {});
    const other = await h.call('203.0.113.2', 'list_categories', {});
    assert.ok(!other.isError);
  });
});

test('burst: the refusal holds across isolate recycling once KV has recorded the window (KV read path)', async () => {
  const h = harness({ start: Date.UTC(2026, 8, 17, 9, 0, 0) }); // window start, so 48 s of calls stay in one window
  await withFetch(h.up.fetchFn, async () => {
    // 121 calls spaced 400 ms: the rate key is written at most once per second yet reaches the limit.
    for (let i = 0; i < RATE_LIMIT_PER_WINDOW; i++) { await h.call('203.0.113.90', 'list_categories', {}); h.advance(400); }
    resetRateValveIsolateStateForTests(); // a new isolate sees only KV
    // Up to ~1 s of calls may still be pending locally in the old isolate; KV holds the rest.
    let r; let extra = 0;
    do { r = await h.call('203.0.113.90', 'list_categories', {}); extra++; h.advance(10); } while (!r.isError && extra < 10);
    assert.ok(isRefusal(r), 'a fresh isolate still refuses within a few calls');
    assert.ok(extra <= 4, `fresh isolate admitted ${extra - 1} extra calls`);
  });
});

// ---------------------------------------------------------------- backstop, faults, keys

test('daily backstop: refuses at DAILY_BACKSTOP with retry-after to 00:00 UTC', async () => {
  const h = harness();
  const day = new Date(h.now()).toISOString().slice(0, 10);
  await h.env.CALL_METER.put(`ip_daily:192.0.2.50:${day}`, String(DAILY_BACKSTOP - 1), { expirationTtl: 172800 });
  h.advance(2000);
  await withFetch(h.up.fetchFn, async () => {
    const last = await h.call('192.0.2.50', 'list_categories', {});
    assert.ok(!last.isError, 'call number DAILY_BACKSTOP is served');
    h.advance(2000);
    const over = await h.call('192.0.2.50', 'list_categories', {});
    assert.ok(isRefusal(over));
    const midnight = Date.parse(`${day}T00:00:00Z`) + 86400000;
    assert.equal(over.retry_after_seconds, Math.ceil((midnight - h.now()) / 1000));
    assert.match(over.content[0].text, /daily safety backstop of 20,000 calls/);
  });
});

test('fail open: a CALL_METER that throws on read and write never refuses a call', async () => {
  const h = harness();
  h.env.CALL_METER = { async get() { throw new Error('KV down'); }, async put() { throw new Error('KV down'); } };
  await withFetch(h.up.fetchFn, async () => {
    for (let i = 0; i < 50; i++) { const r = await h.call('203.0.113.200', 'list_categories', {}); assert.ok(!r.isError); h.advance(1000); }
  });
});

test('legacy keys: an exhausted plan key falls through to the anonymous valve instead of a hard refusal', async () => {
  const h = harness();
  h.env.GPH_API_KEYS = { async get() { return JSON.stringify({ plan: 'developer', status: 'active', callsThisPeriod: 5000 }); }, async put() {} };
  await withFetch(h.up.fetchFn, async () => {
    const r = await h.call('203.0.113.201', 'list_categories', {}, { apiKey: 'k_exhausted' });
    assert.ok(!r.isError, r.content[0].text);
  });
});

// ---------------------------------------------------------------- no licensing pointer

test('no refusal text, code path, runbook or README points to licensing', async () => {
  const texts = [];
  const h = harness();
  await withFetch(h.up.fetchFn, async () => {
    for (let i = 0; i < RATE_LIMIT_PER_WINDOW + 5; i++) {
      const r = await h.call('203.0.113.123', 'list_categories', {});
      if (r.isError) texts.push(r.content[0].text);
    }
    const day = new Date(h.now()).toISOString().slice(0, 10);
    await h.env.CALL_METER.put(`ip_daily:203.0.113.124:${day}`, String(DAILY_BACKSTOP), { expirationTtl: 172800 });
    h.advance(2000);
    const r = await h.call('203.0.113.124', 'list_categories', {});
    texts.push(r.content[0].text);
  });
  assert.ok(texts.length >= 6, 'both refusal kinds were produced');
  for (const t of texts) {
    assert.ok(!/licens|data-licensing|unmetered|paid|purchase|pricing|upgrade/i.test(t), `refusal mentions a product boundary: ${t}`);
    assert.match(t, /Retry after \d+ seconds/);
  }
  assert.ok(!/licens/i.test(source), 'functions/mcp.js carries no licensing pointer (including the ROW_CEILING comment)');
  assert.ok(!/data-licensing|license the dataset/i.test(runbook));
  assert.ok(!/data-licensing|license the dataset/i.test(readme));
  assert.ok(!/100 calls per IP per day/.test(readme));
});

test('valve keys are per IP only: no ASN, organisation or category in any meter key', () => {
  const keys = [...source.matchAll(/`((?:ip_rate|ip_daily):[^`]*)`/g)].map(m => m[1]);
  assert.deepEqual(keys.sort(), ['ip_daily:${ip}:${day}', 'ip_rate:${ip}:${windowStart / 1000}']);
});
