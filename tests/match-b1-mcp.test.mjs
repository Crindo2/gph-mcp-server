// C596 / C710: exercise the advertised schema and real MCP handler with offline upstreams.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  TOOLS, validateArgs, callTool, handleMcpRequest, buildTelemetry,
  TELEMETRY_D1_B1_COLUMNS,
} from '../functions/mcp.js';
import {
  ALL_NEED_CODES, VENDOR_GEO_PREFERENCES, STATE_OPTIONAL_PREFERENCES,
  MAX_SERVICE_NEEDS, NEED_LABEL, EVIDENCE_LABEL, EVIDENCE_SOURCE_LABEL, GEO_BASIS,
} from '../functions/_shared/match-vocab.js';
import { publicConfidence, publicGroundedIn, publicLocations } from '../functions/_shared/enrichment.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const hash = s => createHash('sha256').update(s).digest('hex');
const schema = TOOLS.find(t => t.name === 'match_practice').inputSchema;
const GOLDEN = {
  category: 'Healthcare Staffing & Recruiting', practice_size: 'Small', state: 'TX',
  vendor_geo_preference: 'NATIONAL_OK',
  service_needs: ['STAFFING_ROLE_NP', 'STAFFING_ROLE_PA', 'STAFFING_ENG_PERMANENT', 'STAFFING_SET_URGENT_CARE'],
};
const BASE = { slug: 'fixture-staffing', company_name: 'Fixture staffing', category: GOLDEN.category,
  city: 'Austin', state_abbr: 'TX', quality_score: 75, final_score: 80, verified: 1, claimed: 1 };
const DATA = { success: true, total: 18, matches: [BASE] };

async function withFetch(data, run) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return { ok: true, json: async () => data };
  };
  try { return await run(calls); } finally { globalThis.fetch = real; }
}
async function textFor(match, extra = {}) {
  return withFetch({ ...DATA, matches: [match], ...extra }, async () =>
    (await callTool('match_practice', GOLDEN)).content[0].text);
}
const invoke = args => handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call',
  params: { name: 'match_practice', arguments: args } }, {}, '', { request: new Request('https://fixture.invalid/mcp') });

test('B1 copied vocabulary matches the upstream lock; its dependency preserves the pinned resolver', () => {
  const lock = JSON.parse(read('./fixtures/match-vocab.lock.json'));
  assert.equal(hash(read('../functions/_shared/match-vocab.js')), lock.sha256_lf);
  const sentinel = /\/\/ >>> ENRICHMENT-RESOLVER-V2 BEGIN >>>[\s\S]*?\/\/ <<< ENRICHMENT-RESOLVER-V2 END <<</;
  const moduleBlock = read('../functions/_shared/enrichment.js').match(sentinel)?.[0];
  const inlineBlock = read('../functions/mcp.js').match(sentinel)?.[0];
  assert.ok(moduleBlock && inlineBlock);
  assert.equal(moduleBlock, inlineBlock);
  const resolverLock = JSON.parse(read('./fixtures/enrichment-resolver.lock.json'));
  assert.equal(hash(moduleBlock), resolverLock.block_sha256_lf);
  assert.equal(publicConfidence('injected text'), null);
  assert.equal(publicGroundedIn('injected text'), null);
  assert.equal(publicLocations('["national"]'), '["national"]');
});

test('B1 advertises exact enums, array limits and conditional state requirement', () => {
  assert.equal(schema.properties.vendor_geo_preference.type, 'string');
  assert.deepEqual(schema.properties.vendor_geo_preference.enum, [...VENDOR_GEO_PREFERENCES]);
  assert.deepEqual(VENDOR_GEO_PREFERENCES, ['LOCAL_PREFERRED', 'STATE_PREFERRED', 'NATIONAL_OK', 'NATIONAL_ONLY']);
  assert.equal(schema.properties.service_needs.type, 'array');
  assert.equal(schema.properties.service_needs.items.type, 'string');
  assert.deepEqual(schema.properties.service_needs.items.enum, [...ALL_NEED_CODES]);
  assert.equal(ALL_NEED_CODES.length, 33);
  assert.equal(schema.properties.service_needs.maxItems, MAX_SERVICE_NEEDS);
  assert.equal(schema.properties.service_needs.uniqueItems, true);
  assert.deepEqual(schema.required, ['category']);
  assert.deepEqual(schema.anyOf[0], { required: ['state'] });
  assert.deepEqual(schema.anyOf[1].required, ['vendor_geo_preference']);
  assert.deepEqual(schema.anyOf[1].properties.vendor_geo_preference.enum, [...STATE_OPTIONAL_PREFERENCES]);
});

test('B1 state may be omitted only for national preferences; category remains required', () => {
  for (const pref of VENDOR_GEO_PREFERENCES) {
    const args = { category: GOLDEN.category, vendor_geo_preference: pref };
    if (STATE_OPTIONAL_PREFERENCES.includes(pref)) assert.equal(validateArgs('match_practice', args), null);
    else assert.match(validateArgs('match_practice', args).content[0].text, /requires `state`/);
    assert.equal(validateArgs('match_practice', { ...args, state: 'TX' }), null);
    assert.match(validateArgs('match_practice', { vendor_geo_preference: pref }).content[0].text, /requires `category`/);
  }
  assert.match(validateArgs('match_practice', { category: GOLDEN.category, service_needs: GOLDEN.service_needs }).content[0].text, /requires `state`/);
});

test('B1 invalid types, free text, duplicate/over-limit codes and invented enums never reach upstream', async () => {
  const invalid = [
    { vendor_geo_preference: 'national_ok' }, { vendor_geo_preference: 'constructor' },
    { vendor_geo_preference: [] }, { service_needs: 'NP recruitment' },
    { service_needs: ['NP recruitment'] }, { service_needs: [3] },
    { service_needs: ['STAFFING_ROLE_NP', 'STAFFING_ROLE_NP'] },
    { service_needs: ALL_NEED_CODES.slice(0, 7) },
  ];
  await withFetch(DATA, async calls => {
    for (const patch of invalid) {
      const out = await invoke({ ...GOLDEN, ...patch });
      assert.equal(out.result.isError, true);
      assert.match(out.result.content[0].text, /NOT run/);
    }
    assert.equal(calls.length, 0);
  });
});

test('B1 golden fields and all geo preferences are forwarded unchanged through tools/call', async () => {
  await withFetch(DATA, async calls => {
    for (const pref of VENDOR_GEO_PREFERENCES) {
      const args = { ...GOLDEN, vendor_geo_preference: pref };
      const before = JSON.stringify(args);
      const out = await invoke(args);
      assert.ok(!out.result.isError);
      assert.equal(calls.at(-1).url, 'https://www.getpracticehelp.com/api/match');
      assert.equal(calls.at(-1).options.method, 'POST');
      assert.equal(calls.at(-1).options.body, before);
      assert.equal(JSON.stringify(args), before);
    }
  });
});

test('B1 national requests without state run and forward no invented state', async () => {
  await withFetch(DATA, async calls => {
    for (const pref of STATE_OPTIONAL_PREFERENCES) {
      const args = { category: GOLDEN.category, vendor_geo_preference: pref, service_needs: [] };
      assert.ok(!(await invoke(args)).result.isError);
      assert.deepEqual(JSON.parse(calls.at(-1).options.body), args);
    }
  });
});

test('old-style category plus state still works, preserving payload, count, slugs and text', async () => {
  await withFetch(DATA, async calls => {
    const args = { category: 'Medical Billing & RCM', state: 'TX' };
    const out = (await invoke(args)).result;
    assert.deepEqual(JSON.parse(calls[0].options.body), args);
    assert.equal(out.count, 18);
    assert.deepEqual(out.ids.surfaced, ['fixture-staffing']);
    assert.match(out.content[0].text, /Found 18 providers\. Top 1 matches:/);
    assert.doesNotMatch(out.content[0].text, /Service-need|Why matched|extraction date|verified/i);
  });
});

test('B1 renders every closed need/evidence/source/geography label and public extraction labels', async () => {
  for (const [need, label] of Object.entries(NEED_LABEL)) {
    const text = await textFor({ ...BASE, why_matched: [{ need, evidence: 'services', source: 'enriched', confidence: 'high', grounded_in: 'site' }], evidence_checked: '2026-10-02' });
    assert.ok(text.includes(label));
    assert.match(text, /listed services; GPH-researched; extraction confidence high; grounded in vendor website/);
    assert.match(text, /Profile extraction date: 2026-10-02/);
    assert.doesNotMatch(text, /verified|paid|sponsored/i);
  }
  for (const [evidence, label] of Object.entries(EVIDENCE_LABEL)) {
    assert.ok((await textFor({ ...BASE, why_matched: [{ need: 'STAFFING_ROLE_NP', evidence, source: 'legacy' }] })).includes(label));
  }
  for (const [source, label] of Object.entries(EVIDENCE_SOURCE_LABEL)) {
    const text = await textFor({ ...BASE, why_matched: [{ need: 'STAFFING_ROLE_NP', evidence: 'services', source, confidence: 'high', grounded_in: 'site' }] });
    assert.ok(text.includes(label));
    if (source !== 'enriched') assert.doesNotMatch(text, /extraction confidence|grounded in/);
  }
  for (const [geo_basis, label] of Object.entries(GEO_BASIS)) assert.ok((await textFor({ ...BASE, geo_basis })).includes(label));
});

test('B1 unknown/hostile evidence values and malformed dates cannot become public copy', async () => {
  for (const code of ['constructor', '__proto__', 'INTERNAL_TEXT_SENTINEL']) {
    const text = await textFor({ ...BASE, why_matched: [
      { need: code, evidence: 'services', source: 'enriched' },
      { need: 'STAFFING_ROLE_NP', evidence: code, source: 'enriched' },
      { need: 'STAFFING_ROLE_NP', evidence: 'services', source: code },
      { need: 'STAFFING_ROLE_NP', evidence: 'services', source: 'enriched', confidence: code, grounded_in: code },
    ], geo_basis: code, evidence_checked: code });
    assert.ok(!text.includes(code));
    assert.doesNotMatch(text, /extraction confidence|grounded in|Geography basis|extraction date/);
  }
  for (const date of ['2026-02-30', '2026-10-02T12:00:00Z', 42, null]) {
    assert.doesNotMatch(await textFor({ ...BASE, evidence_checked: date }), /extraction date/);
  }
  assert.match(await textFor({ ...BASE, why_matched: [] }), /evidence: unknown for this vendor/);
});

test('B1 summary honestly distinguishes API top-ten evidence from displayed top five', async () => {
  await withFetch({ ...DATA, matches: Array.from({ length: 10 }, (_, i) => ({ ...BASE, slug: `fixture-${i}` })),
    needs_summary: { requested: 4, evidenced_any: 3, unknown: 1 }, geo_honesty_note: 'Fixture regional-only note.' }, async () => {
    const out = await callTool('match_practice', GOLDEN);
    assert.equal(out.ids.surfaced.length, 5);
    assert.match(out.content[0].text, /API shortlist \(up to 10 providers\): 3\/4 requested codes evidenced; 1 unknown/);
    assert.match(out.content[0].text, /Missing evidence is unknown/);
    assert.match(out.content[0].text, /Fixture regional-only note/);
    assert.doesNotMatch(out.content[0].text, /fixture-5/);
  });
  const empty = await textFor(BASE, { matches: [], total: 0, needs_summary: { requested: 4, evidenced_any: 0, unknown: 4 } });
  assert.match(empty, /0\/4 requested codes evidenced; 4 unknown/);
  assert.match(empty, /No matching providers/);
  const malformed = await textFor(BASE, { needs_summary: { requested: 4, evidenced_any: 'INTERNAL_TEXT_SENTINEL', unknown: 1 } });
  assert.doesNotMatch(malformed, /INTERNAL_TEXT_SENTINEL|Service-need coverage/);
});

test('B1 upstream applicability errors remain errors, without fabricated matches', async () => {
  await withFetch({ success: false, error: 'service_needs contains a code that does not apply to this category' }, async () => {
    const out = (await invoke({ ...GOLDEN, category: 'EHR' })).result;
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /does not apply to this category/);
    assert.equal(out.ids, undefined);
  });
});

test('C596 B1 dimensions reach telemetry without changing traffic classification', async () => {
  const request = new Request('https://fixture.invalid/mcp');
  const row = await buildTelemetry('gph', request, {}, 'match_practice', GOLDEN, 18, 'anonymous', {});
  assert.equal(row.vendor_geo_preference, 'NATIONAL_OK');
  assert.deepEqual(JSON.parse(row.service_needs), GOLDEN.service_needs);
  assert.equal(row.traffic_class, 'demand');
  assert.deepEqual(TELEMETRY_D1_B1_COLUMNS, ['vendor_geo_preference', 'service_needs']);
  const old = await buildTelemetry('gph', request, {}, 'match_practice', { category: 'billing', state: 'TX' }, 18, 'anonymous', {});
  assert.equal(old.vendor_geo_preference, null);
  assert.equal(old.service_needs, null);
});

test('C596 migration lag preserves the existing telemetry row via M2 fallback', async () => {
  const pending = [], rows = [], attempts = [];
  const db = { prepare(sql) { return { bind(...values) { return { async run() {
    const cols = sql.match(/\(([^)]*)\)\s*VALUES/)[1].split(',').map(s => s.trim());
    attempts.push(cols);
    if (cols.includes('service_needs')) throw new Error('table mcp_usage_log has no column named service_needs');
    rows.push(Object.fromEntries(cols.map((c, i) => [c, values[i]])));
  } }; } }; } };
  const realError = console.error;
  console.error = () => {};
  try {
    await withFetch(DATA, async () => {
      const result = await handleMcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'match_practice', arguments: GOLDEN } },
        { TELEMETRY_DB: db }, '', { request: new Request('https://fixture.invalid/mcp'), waitUntil: p => pending.push(p) });
      assert.ok(!result.result.isError);
      await Promise.all(pending);
    });
  } finally { console.error = realError; }
  assert.equal(attempts.length, 2);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].traffic_class, 'demand');
  assert.deepEqual(JSON.parse(rows[0].raw_args).service_needs, GOLDEN.service_needs);
});
