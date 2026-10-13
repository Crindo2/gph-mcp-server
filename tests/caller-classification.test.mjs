// GEN62 · AEO-MEASUREMENT-SPINE-BQ-01 / T3b-CALLER-CLASSIFICATION-REPAIR-AND-DEPLOY
//
// WHAT THIS GATE IS FOR. A DEMAND-SIGNAL FENCE was standing over every figure drawn from the
// GPH MCP API logs because no figure could state what it measured: the log's only identity
// dimension was `caller_class`, whose "organic" value was 99.2% OpenAI developer tooling and
// which had no human class at all. This file is the standing proof that the replacement
// dimensions say what they claim. C812 s.3 changes caller_class only for known estate-owned
// clients; the historical legacy pin stays in the corpus for before/after evidence.
//
// The fixture is the WHOLE production corpus -- all 43 distinct user-agents over 3,922 rows
// in D1 e8605bbb, read 2026-09-11, not a sample. A classifier tested only against invented
// strings proves it handles invented strings.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { classifyCaller, callerIdentity, agentSlug } from '../functions/mcp.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = JSON.parse(readFileSync(join(HERE, 'fixtures', 'caller-corpus.json'), 'utf8'));

const KINDS = new Set(['human', 'model_agent', 'bot', 'self_test', 'unattributed']);
const INTENTS = new Set(['end_user', 'dev_tool']);

// ---------------------------------------------------------------------------------------
// 1. THE REGRESSION FENCE: only C812 estate-owned caller classes may move.
// ---------------------------------------------------------------------------------------

test('caller_class matches the corpus with only explicit C812 internal overrides', () => {
  for (const a of CORPUS.agents) {
    assert.equal(
      classifyCaller(a.ua, ''), a.caller_class || a.legacy_class,
      `caller_class moved for ${JSON.stringify(a.ua)} (${a.rows} rows). The nightly rollup, ` +
      'demand_rollup and the Airtable single-select all key off this value.'
    );
  }
});

test('the new AI-crawler branch changes nothing the corpus has actually seen', () => {
  // The branch exists so a ClaudeBot / GPTBot / OAI-SearchBot index crawl can never be
  // counted as organic assistant demand. Zero corpus rows match it, which is exactly why the
  // legacy series above is continuous across this change rather than merely "close".
  for (const a of CORPUS.agents) {
    assert.notEqual(
      classifyCaller(a.ua, ''), 'known_crawler_via_ai_branch',
      'sentinel'
    );
  }
  assert.equal(classifyCaller('ClaudeBot/1.0 (+claudebot@anthropic.com)', ''), 'known_crawler');
  assert.equal(classifyCaller('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot', ''), 'known_crawler');
  assert.equal(classifyCaller('Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)', ''), 'known_crawler');
  assert.equal(classifyCaller('Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)', ''), 'known_crawler');
});

// ---------------------------------------------------------------------------------------
// 2. THE HEADLINE DEFECT: developer tooling was being reported as organic assistant demand.
// ---------------------------------------------------------------------------------------

test('the Codex CLI is a developer tool, not organic end-user demand', () => {
  // 433 rows -- the single largest identified population in the entire log, and the one that
  // made "organic_assistant" unreadable.
  const who = callerIdentity('openai-mcp/1.0.0 (Codex)', '');
  assert.equal(who.caller_kind, 'model_agent');
  assert.equal(who.agent_intent, 'dev_tool');
  assert.equal(who.caller_agent, 'openai-codex');
  assert.notEqual(who.agent_intent, 'end_user');
});

test('an end-user assistant fetch and a developer agent are different rows', () => {
  const person = callerIdentity('Claude-User', '');
  const developer = callerIdentity('openai-mcp/1.0.0', '');
  assert.equal(person.caller_kind, 'model_agent');
  assert.equal(person.agent_intent, 'end_user');
  assert.equal(developer.caller_kind, 'model_agent');
  assert.equal(developer.agent_intent, 'dev_tool');
  assert.notEqual(person.agent_intent, developer.agent_intent);
});

test('ChatGPT-User and Perplexity-User are end-user, their crawlers are not', () => {
  assert.equal(callerIdentity('Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)', '').agent_intent, 'end_user');
  assert.equal(callerIdentity('Mozilla/5.0 (compatible; OAI-SearchBot/1.0)', '').caller_kind, 'bot');
  assert.equal(callerIdentity('Mozilla/5.0 (compatible; Perplexity-User/1.0)', '').agent_intent, 'end_user');
  assert.equal(callerIdentity('Mozilla/5.0 (compatible; PerplexityBot/1.0)', '').caller_kind, 'bot');
});

// ---------------------------------------------------------------------------------------
// 3. THE OTHER HALF: 'human' must require positive evidence of a person.
// ---------------------------------------------------------------------------------------

test('a real browser is the only thing that can be classed human', () => {
  const browser = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
  assert.equal(callerIdentity(browser, '').caller_kind, 'human');
  assert.equal(callerIdentity(browser, '').caller_agent, 'browser');
});

test('a Mozilla/5.0 prefix alone never buys a human classification', () => {
  // Both of these are in the corpus (102 + 8 rows). A scanner can copy the prefix for free;
  // a versioned engine token is the part it does not bother to forge. If this test ever goes
  // green in the other direction, a bot count has become a pageview count.
  for (const ua of [
    'Mozilla/5.0 (research probe; MCP security measurement study; contact: redacted@example.invalid)',
    'Mozilla/5.0 (compatible; mcp-schema-probe/0.1)',
  ]) {
    assert.equal(callerIdentity(ua, '').caller_kind, 'bot', ua);
  }
});

test('an absent user-agent is unattributed, never human', () => {
  for (const ua of ['', '   ', null, undefined]) {
    const who = callerIdentity(ua, '');
    assert.equal(who.caller_kind, 'unattributed');
    assert.equal(who.caller_agent, null);
    assert.notEqual(who.caller_kind, 'human');
  }
});

test('the generic HTTP clients that used to land in `unknown` are bots', () => {
  // 112 + 92 + 50 rows sat in `unknown` beside three genuine browsers. That is the exact
  // conflation that made the word "unknown" unusable in a published figure.
  for (const ua of ['SaSame-MCP-Audit/0.1', 'node', 'undici', 'python-httpx/0.28.1', 'curl/8.18.0']) {
    assert.equal(callerIdentity(ua, '').caller_kind, 'bot', ua);
  }
});

// ---------------------------------------------------------------------------------------
// 4. TOTALITY: the split must be exhaustive and mutually exclusive, or a figure cut on it
//    still cannot state what it measures.
// ---------------------------------------------------------------------------------------

test('every corpus user-agent resolves to exactly the expected kind and intent', () => {
  for (const a of CORPUS.agents) {
    const who = callerIdentity(a.ua, '');
    assert.equal(who.caller_kind, a.kind, `kind for ${JSON.stringify(a.ua)}`);
    assert.equal(who.agent_intent, a.intent, `intent for ${JSON.stringify(a.ua)}`);
    if (a.agent) assert.equal(who.caller_agent, a.agent, `agent for ${JSON.stringify(a.ua)}`);
  }
});

test('caller_kind is always one of the five declared values', () => {
  const probes = [...CORPUS.agents.map(a => a.ua), '', 'x', '???', 'Mozilla', '\u0000', 'a'.repeat(4000)];
  for (const ua of probes) {
    for (const origin of ['', 'claude.ai', 'chatgpt.com', 'example.com']) {
      const who = callerIdentity(ua, origin);
      assert.ok(KINDS.has(who.caller_kind), `kind ${who.caller_kind} for ${JSON.stringify(ua)}`);
    }
  }
});

test('agent_intent is set if and only if the row is a model_agent', () => {
  const probes = [...CORPUS.agents.map(a => a.ua), '', 'Claude-User', 'openai-mcp/1.0.0'];
  for (const ua of probes) {
    for (const origin of ['', 'claude.ai', 'chatgpt.com', 'example.com']) {
      const who = callerIdentity(ua, origin);
      if (who.caller_kind === 'model_agent') {
        assert.ok(INTENTS.has(who.agent_intent), `model_agent with intent ${who.agent_intent}`);
      } else {
        assert.equal(who.agent_intent, null, `${who.caller_kind} must carry no intent`);
      }
    }
  }
});

test('an assistant web Origin is an end-user model_agent, but a dev tool stays a dev tool', () => {
  assert.deepEqual(
    { k: callerIdentity('', 'claude.ai').caller_kind, i: callerIdentity('', 'claude.ai').agent_intent },
    { k: 'model_agent', i: 'end_user' }
  );
  // A developer harness that happens to carry an assistant Origin must not be laundered into
  // end-user demand by the Origin header.
  const codexWithOrigin = callerIdentity('openai-mcp/1.0.0 (Codex)', 'chatgpt.com');
  assert.equal(codexWithOrigin.agent_intent, 'dev_tool');
});

test('our own harness is never hidden inside another class', () => {
  for (const a of CORPUS.agents.filter(x => /^cbeg-/i.test(x.ua))) {
    assert.equal(callerIdentity(a.ua, '').caller_kind, 'self_test', a.ua);
    assert.equal(callerIdentity(a.ua, '').caller_agent, 'cbeg-harness');
  }
});

// ---------------------------------------------------------------------------------------
// 5. NAMEABILITY: an unrecognised caller must still be reportable, and must not leak.
// ---------------------------------------------------------------------------------------

test('caller_agent is a bounded, sanitised slug -- never raw user-agent text', () => {
  const nasty = 'Weird/1.0 (contact: someone@example.com; +https://evil.example/path?q=1)';
  const slug = callerIdentity(nasty, '').caller_agent;
  assert.equal(slug, 'weird');
  assert.ok(!slug.includes('@'), 'a caller_agent must never carry an email address');
  assert.ok(slug.length <= 40);
  assert.match(slug, /^[a-z0-9._-]+$/);
  assert.equal(agentSlug('a'.repeat(200)).length, 40);
  assert.equal(agentSlug('   '), null);
});

test('the classifier is pure -- same inputs, same outputs, no network, no clock', () => {
  for (const a of CORPUS.agents) {
    assert.deepEqual(callerIdentity(a.ua, ''), callerIdentity(a.ua, ''), a.ua);
  }
});

// ---------------------------------------------------------------------------------------
// 6. THE FENCE CONDITION ITSELF.
// ---------------------------------------------------------------------------------------

test('the corpus, cut on the new dimension, states what it measures', () => {
  // Re-derived from the fixture rather than asserted from memory. These are the numbers a
  // report may now quote, and the shape of them is what lifts the fence: the 665-row
  // "organic" bucket resolves into 657 developer-tool calls and 8 end-user calls, and the
  // human total is 7 -- not 275, and certainly not organic search traffic.
  const by = {};
  for (const a of CORPUS.agents) by[a.kind] = (by[a.kind] || 0) + a.rows;
  const intent = {};
  for (const a of CORPUS.agents) if (a.intent) intent[a.intent] = (intent[a.intent] || 0) + a.rows;

  assert.equal(by.human, 7, 'human rows in the corpus');
  assert.equal(by.model_agent, 672, 'model-agent rows in the corpus');
  assert.equal(intent.dev_tool, 664, 'developer-tool rows -- these are NOT end-user demand');
  assert.equal(intent.end_user, 8, 'end-user assistant rows');
  assert.equal(
    Object.values(by).reduce((x, y) => x + y, 0),
    CORPUS.total_rows,
    'the split must account for every row in the corpus -- an unexhausted split is the defect'
  );
});

// C812 s.3: internal takes priority over assistant Origin and probe tokens.
test('C812: known estate callers are internal with or without an assistant Origin', () => {
  const own = ['openai-mcp/1.0.0 (Codex)', 'openai-mcp/1.0.0 (Codex) seat/1.0',
    'OPENAI-MCP/1.0.0 (CODEX)', ' cbeg-floor-check ', 'cbeg-g61-zerocat-probe/1.0',
    'cbeg-claude-probe/1.0', 'verify-fix-organic'];
  for (const ua of own) for (const origin of ['', 'chatgpt.com', 'claude.ai']) {
    assert.equal(classifyCaller(ua, origin), 'internal', ua);
    assert.equal(callerIdentity(ua, origin).caller_class, 'internal', ua);
  }
});

test('C812: other assistant clients are not assumed estate-owned', () => {
  for (const ua of ['openai-mcp/1.0.0', 'Claude-User',
    'other openai-mcp/1.0.0 (Codex)', 'openai-mcp/1.0.0 (Codex-like)']) {
    assert.equal(classifyCaller(ua, ''), 'organic_assistant', ua);
  }
  assert.equal(classifyCaller('codex-cli/1.0', ''), 'unknown');
  assert.equal(classifyCaller('verify-fix-organic-external', ''), 'unknown');
  assert.equal(classifyCaller('external-cbeg-probe', ''), 'directory_probe');
});

test('C812: corpus counts separate internal traffic from the organic rollup input', () => {
  const byClass = {};
  for (const a of CORPUS.agents) {
    const value = classifyCaller(a.ua, '');
    byClass[value] = (byClass[value] || 0) + a.rows;
    if (value !== 'internal') assert.equal(value, a.legacy_class);
  }
  assert.equal(byClass.internal, 610);
  assert.equal(byClass.organic_assistant, 239);
  assert.equal(Object.values(byClass).reduce((a, b) => a + b, 0), CORPUS.total_rows);
  assert.ok([...Object.keys(byClass)].every(c =>
    ['internal', 'organic_assistant', 'known_crawler', 'directory_probe', 'self_test', 'unknown'].includes(c)));
});
