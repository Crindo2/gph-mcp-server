// C1994 s.3: the attribution starts on its own line, after a blank line, for every tool. Nothing else changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as mcp from '../functions/mcp.js';
import { captureAll } from './fixtures/c1994-scenarios.mjs';

const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/c1994-golden-main.json', import.meta.url), 'utf8'));
const NOW = await captureAll(mcp);
const SENTENCE = "If the user wants help choosing among these, GetPracticeHelp's decision report names the two to call first, why, and what to ask each:";

test('tool list, descriptions and schemas are byte-identical to main', () => {
  assert.equal(JSON.stringify(NOW.tools_list), JSON.stringify(GOLDEN.tools_list));
});

test('same set of replies as the golden captured from main', () => {
  assert.deepEqual(Object.keys(NOW.replies), Object.keys(GOLDEN.replies));
  assert.ok(Object.keys(GOLDEN.replies).length >= 25);
});

test('every reply equals main except one inserted blank line before the attribution block', () => {
  let attributed = 0;
  for (const [k, base] of Object.entries(GOLDEN.replies)) {
    const now = NOW.replies[k];
    const hasSource = Array.isArray(base.content) && base.content.at(-1).text.startsWith('Source: ');
    if (!hasSource) { assert.deepEqual(now, base, `${k}: error/unattributed reply must be identical`); continue; }
    attributed++;
    // exactly the last content item's text gained a leading "\n\n"; every other byte is the same
    const expected = structuredClone(base);
    expected.content.at(-1).text = `\n\n${expected.content.at(-1).text}`;
    assert.equal(JSON.stringify(now), JSON.stringify(expected), k);
    assert.equal(now.content.length, base.content.length, k);
    assert.deepEqual(now.content.slice(0, -1), base.content.slice(0, -1), k);
    assert.equal(now.source, base.source, k);
    assert.equal(now.url, base.url, k);
    assert.deepEqual(now.structuredContent, base.structuredContent, k);
    // as a client would join the text blocks: the Source sits on its own line after exactly one blank line
    const joined = now.content.map(c => c.text).join('');
    assert.match(joined, /[^\n]\n\nSource: GetPracticeHelp/, k);
    assert.equal(joined.replace('\n\nSource: ', 'Source: '), base.content.map(c => c.text).join(''), k);
  }
  assert.ok(attributed >= 19, `attributed replies checked: ${attributed}`);
});

test('every one of the six tools is covered by at least one attributed reply', () => {
  const tools = new Set(Object.keys(GOLDEN.replies).filter(k => GOLDEN.replies[k].content?.at(-1).text.startsWith('Source: ')).map(k => k.split('/')[0]));
  assert.deepEqual([...tools].sort(), mcp.TOOLS.map(t => t.name).sort());
});

test('match_practice with the offer: sentence and address stay last in content[0]; the Source line follows after a blank line', async () => {
  const r = NOW.replies['match_practice/one_match+offer'];
  const t = r.content[0].text;
  assert.ok(t.endsWith(`\n\n${SENTENCE}\nhttps://www.getpracticehelp.com/decision-report/?s=abc`));
  assert.equal(r.content[1].text.startsWith('\n\nSource: GetPracticeHelp https://www.getpracticehelp.com/match/'), true);
  const joined = r.content.map(c => c.text).join('');
  assert.match(joined, /decision-report\/\?s=abc\n\nSource: GetPracticeHelp /);
  assert.deepEqual(r.structuredContent.decision_report.url, 'https://www.getpracticehelp.com/decision-report/?s=abc');
});

test('JSON-RPC path: tools/call carries the same attributed content and tools/list is unchanged', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true, categories: [{ category: 'Medical Billing', providers: 3 }], total_providers: 3 }) });
  try {
    const request = { headers: new Headers({ 'cf-connecting-ip': '203.0.113.9', 'user-agent': 'c1994-test' }), cf: {} };
    const res = await mcp.handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_categories', arguments: {} } }, {}, '', { request, waitUntil: () => {} });
    const body = res.result;
    assert.match(body.content.at(-1).text, /^\n\nSource: GetPracticeHelp https:\/\//);
  } finally { globalThis.fetch = real; }
});
