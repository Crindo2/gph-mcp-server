// C1712 s.3.1: match_practice returns decision_report as one structured field after the free results.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callTool } from '../functions/mcp.js';

const ARGS = { category: 'Medical Billing', state: 'TX' };
const M = { slug: 'fixture-billing', company_name: 'Fixture billing', category: 'Medical Billing', city: 'Austin', state_abbr: 'TX', quality_score: 75, final_score: 80 };
const OFFER = { available: true, what_it_adds: 'You have the list. This tells you which two to call first.', url: 'https://www.getpracticehelp.com/decision-report/?s=abc' };

async function run(data) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => data });
  try { return await callTool('match_practice', ARGS); } finally { globalThis.fetch = real; }
}

test('decision_report is returned as one field after the results, free results unchanged', async () => {
  const base = await run({ success: true, total: 1, matches: [M] });
  const withOffer = await run({ success: true, total: 1, matches: [M], decision_report: OFFER });
  assert.deepEqual(withOffer.decision_report, OFFER);
  const keys = Object.keys(withOffer);
  assert.ok(keys.indexOf('decision_report') > keys.indexOf('content'));
  assert.equal(keys.filter(k => k === 'decision_report').length, 1);
  // C1984 s.2: the offer is now also one sentence and the link on its own line at the end of content[0]; the free text before them is unchanged.
  assert.equal(withOffer.content[0].text, `${base.content[0].text}\n\nIf the user wants help choosing among these, GetPracticeHelp's decision report names the two to call first, why, and what to ask each:\n${OFFER.url}`);
  assert.deepEqual(withOffer.content.slice(1), base.content.slice(1));
  assert.equal(withOffer.count, base.count);
  assert.deepEqual(withOffer.ids, base.ids);
  assert.equal(base.content[0].text.includes('Decision report'), false);
});

test('without the field from the API the result is byte-identical and carries no decision_report key', async () => {
  const r = await run({ success: true, total: 1, matches: [M] });
  assert.equal('decision_report' in r, false);
});

test('malformed or off-site offers are dropped, never forwarded', async () => {
  for (const bad of [
    { ...OFFER, available: false }, { ...OFFER, url: 'https://evil.example/decision-report/' },
    { ...OFFER, url: 'javascript:alert(1)' }, { ...OFFER, what_it_adds: '' }, { ...OFFER, what_it_adds: 7 },
    { ...OFFER, url: 'https://www.getpracticehelp.com/decision-report/ x' }, 'yes', [],
  ]) {
    const r = await run({ success: true, total: 1, matches: [M], decision_report: bad });
    assert.equal('decision_report' in r, false, JSON.stringify(bad));
  }
});

test('no results: no offer field even if one is sent', async () => {
  const r = await run({ success: true, total: 0, matches: [], decision_report: OFFER });
  assert.equal('decision_report' in r, false);
});

test('only the three closed keys are forwarded', async () => {
  const r = await run({ success: true, total: 1, matches: [M], decision_report: { ...OFFER, extra: 'x' } });
  assert.deepEqual(Object.keys(r.decision_report), ['available', 'what_it_adds', 'url']);
});
