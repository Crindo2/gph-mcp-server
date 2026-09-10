// AGENT-INTERNAL-UA-01 (G61, ALLOC-MCP-ZEROCAT-CALLERCLASS-G61-001, 2026-09-10).
//
// Confirmed live defect (GPH MCP API Logs, 10:08-10:09): `openai-mcp/1.0.0 (Codex)` -- our
// own Codex-CLI diagnostic harness -- swept list_categories then 5 categories in one minute,
// and all 6 calls classed organic_assistant. That is enumeration counted as organic demand.
// self_test already existed for cbeg-* UAs (SR-UA fix, 2026-07-03) -- the matcher was
// INCOMPLETE, not absent. This suite proves the extension closes the gap WITHOUT breaking
// genuine third-party assistant classification (AM2's own discriminator requirement: a
// classify-everything-internal matcher must not pass vacuously).
//
//   node --test tests/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCaller, isInternalAgentUA, assistantFromUA } from '../functions/mcp.js';

// --- the confirmed defect, closed ---------------------------------------------------------

test('AGENT-INTERNAL-UA-01: the actual logged UA now classes agent_internal, not organic_assistant', () => {
  // Verbatim UA from the log evidence quoted in the directive.
  const ua = 'openai-mcp/1.0.0 (Codex)';
  assert.equal(classifyCaller(ua, ''), 'agent_internal');
  assert.notEqual(classifyCaller(ua, ''), 'organic_assistant');
});

test('AGENT-INTERNAL-UA-01: Claude Code self-identified traffic also classes agent_internal', () => {
  assert.equal(classifyCaller('claude-code-mcp-client/1.0 (Claude Code)', ''), 'agent_internal');
  assert.equal(classifyCaller('some-sdk/2.1 (claude code)', ''), 'agent_internal');
});

test('isInternalAgentUA is the discriminating predicate classifyCaller relies on', () => {
  assert.equal(isInternalAgentUA('openai-mcp/1.0.0 (Codex)'), true);
  assert.equal(isInternalAgentUA('claude-code/0.9 (Claude Code)'), true);
});

// --- the discriminator: genuine third-party assistant traffic is UNTOUCHED ---------------
//
// AM2: the rule ships with its enforcement or it is not a rule. A matcher that reclassed
// every UA containing "openai"/"claude"/"anthropic" as internal would pass the tests above
// vacuously -- it would also swallow real ChatGPT/Claude/Anthropic-SDK end-user traffic,
// which is exactly the organic_assistant signal GPH-MCP-DEMAND-SHAPE-01 exists to measure.
// These cases assert that traffic is NOT reclassified.

test('discriminator: a genuine ChatGPT-app MCP call (no internal-harness suffix) still classes organic_assistant', () => {
  assert.equal(classifyCaller('openai-mcp/1.0.0', ''), 'organic_assistant');
  assert.equal(classifyCaller('ChatGPT-User/1.0', ''), 'organic_assistant');
});

test('discriminator: a genuine Claude/Anthropic-SDK call still classes organic_assistant', () => {
  assert.equal(classifyCaller('claude-mcp/1.0', ''), 'organic_assistant');
  assert.equal(classifyCaller('anthropic-sdk-python/0.5', ''), 'organic_assistant');
});

test('discriminator: assistantFromUA itself is unchanged (isInternalAgentUA is a separate, prior gate)', () => {
  assert.equal(assistantFromUA('openai-mcp/1.0.0 (Codex)'), 'chatgpt');
  assert.equal(assistantFromUA('claude-code/0.9 (Claude Code)'), 'claude');
});

test('discriminator: Origin-header-verified assistant traffic (chatgpt.com/claude.ai) is unaffected and takes priority', () => {
  assert.equal(classifyCaller('openai-mcp/1.0.0 (Codex)', 'chatgpt.com'), 'organic_assistant');
  assert.equal(classifyCaller('anything', 'claude.ai'), 'organic_assistant');
});

// --- no-regression: existing classes are untouched ----------------------------------------

test('no-regression: cbeg-* self_test is still checked before the new internal-agent gate', () => {
  assert.equal(classifyCaller('cbeg-floor-check/1.0', ''), 'self_test');
  assert.equal(classifyCaller('cbeg-p3d-verify/1.0', ''), 'self_test');
});

test('no-regression: known_crawler traffic (python-requests, curl, bots) is untouched', () => {
  assert.equal(classifyCaller('python-requests/2.31', ''), 'known_crawler');
  assert.equal(classifyCaller('curl/8.4.0', ''), 'known_crawler');
  assert.equal(classifyCaller('Googlebot/2.1', ''), 'known_crawler');
});

test('no-regression: a bare non-assistant, non-internal UA still classes unknown', () => {
  assert.equal(classifyCaller('MyCustomApp/1.0', ''), 'unknown');
});

test('no-regression: empty UA still classes unknown', () => {
  assert.equal(classifyCaller('', ''), 'unknown');
  assert.equal(classifyCaller(null, ''), 'unknown');
});
