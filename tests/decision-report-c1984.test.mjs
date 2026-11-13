// C1984 s.2: the decision report offer is also one sentence and the link at the end of the match_practice reply text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { callTool } from '../functions/mcp.js';
import { SCENARIOS, OFFER, runScenario } from './fixtures/c1984-scenarios.mjs';

const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/c1984-golden-main.json', import.meta.url), 'utf8'));
const SENTENCE = "If the user wants help choosing among these, GetPracticeHelp's decision report names the two to call first, why, and what to ask each:";
const TAIL = `\n\n${SENTENCE}\n${OFFER.url}`;
const SOURCE = /\nSource: GetPracticeHelp /;

test('field absent: every scenario reply is byte-identical to the golden captured from main before the change', async () => {
  for (const n of Object.keys(SCENARIOS)) {
    const r = await runScenario(callTool, n);
    assert.equal(JSON.stringify(r, null, 2), JSON.stringify(GOLDEN[n], null, 2), n);
    assert.equal('structuredContent' in r, false, n);
    assert.equal('decision_report' in r, false, n);
  }
});

test('field present: free text is an unchanged prefix, the sentence and link follow the last firm, nothing else moves', async () => {
  for (const n of ['one_match', 'six_matches_sliced_to_five', 'with_evidence_and_summary', 'honesty_note']) {
    const base = GOLDEN[n];
    const r = await runScenario(callTool, n, 'match_practice', { decision_report: OFFER });
    assert.equal(r.content[0].text, base.content[0].text + TAIL, n);
    assert.ok(r.content[0].text.startsWith(base.content[0].text), n);
    // two lines only, appended at the very end of content[0]; the attribution block is untouched
    assert.deepEqual(r.content.slice(1), base.content.slice(1), n);
    assert.equal(r.count, base.count);
    assert.deepEqual(r.ids, base.ids);
    assert.equal(r.source, base.source);
    assert.equal(r.url, base.url);
    assert.deepEqual(r.decision_report, OFFER);
    assert.deepEqual(r.structuredContent, { decision_report: OFFER });
    assert.ok(Object.keys(r).indexOf('decision_report') > Object.keys(r).indexOf('content'));
    // the offer sits after the last firm's Profile line
    const t = r.content[0].text;
    assert.ok(t.lastIndexOf('   Profile: ') < t.indexOf(SENTENCE), n);
    // no price, refund wording or email ask in the added text
    assert.equal(/\$|price|refund|e-?mail/i.test(TAIL), false);
    // free firm order unchanged
    const firms = s => [...s.matchAll(/^\d+\. \*\*(.+?)\*\*/gm)].map(m => m[1]);
    assert.deepEqual(firms(t), firms(base.content[0].text), n);
  }
});

test('no results, API failure, or malformed offer: reply identical to golden, no offer text', async () => {
  for (const n of ['no_results', 'api_failure']) {
    const r = await runScenario(callTool, n, 'match_practice', { decision_report: OFFER });
    assert.equal(JSON.stringify(r), JSON.stringify(GOLDEN[n]), n);
  }
  for (const bad of [{ ...OFFER, available: false }, { ...OFFER, url: 'https://evil.example/decision-report/' }, { ...OFFER, what_it_adds: '' }, { ...OFFER, what_it_adds: 'x'.repeat(401) }, 'yes', []]) {
    const r = await runScenario(callTool, 'one_match', 'match_practice', { decision_report: bad });
    assert.equal(JSON.stringify(r), JSON.stringify(GOLDEN.one_match), JSON.stringify(bad));
  }
});

test('what_it_adds is not in the reply text; it stays in the structured field unchanged', async () => {
  const w = 'one\n\ntwo';
  const r = await runScenario(callTool, 'one_match', 'match_practice', { decision_report: { ...OFFER, what_it_adds: w } });
  assert.equal(r.content[0].text.endsWith(TAIL), true);
  assert.equal(r.structuredContent.decision_report.what_it_adds, w);
  assert.equal(r.decision_report.what_it_adds, w);
});

test('other tools are untouched: an offer in a list_categories reply payload changes nothing', async () => {
  const real = globalThis.fetch;
  const data = { success: true, total_providers: 3, categories: [{ category: 'Medical Billing', providers: 3 }] };
  globalThis.fetch = async () => ({ ok: true, json: async () => data });
  try {
    const a = await callTool('list_categories', {});
    data.decision_report = OFFER;
    const b = await callTool('list_categories', {});
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(/Decision report/.test(JSON.stringify(b)), false);
  } finally { globalThis.fetch = real; }
});
