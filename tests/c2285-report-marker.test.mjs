// C2285 s.8.4: the match_practice reply's decision-report link carries the fixed marker ref=mcp (no session id, no person data).
//   node --test tests/c2285-report-marker.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decisionReportReplyUrl } from '../functions/mcp.js';

test('a link with a session query gets &ref=mcp', () => {
  assert.equal(decisionReportReplyUrl('https://www.getpracticehelp.com/decision-report/?s=abc'),
    'https://www.getpracticehelp.com/decision-report/?s=abc&ref=mcp');
});

test('a bare link gets ?ref=mcp', () => {
  assert.equal(decisionReportReplyUrl('https://www.getpracticehelp.com/decision-report/'),
    'https://www.getpracticehelp.com/decision-report/?ref=mcp');
});

test('the marker is a constant: no session id or other value is added', () => {
  const out = decisionReportReplyUrl('https://www.getpracticehelp.com/decision-report/?s=xyz');
  assert.match(out, /[?&]ref=mcp$/);
  assert.equal(out.split('ref=').length, 2);
});
