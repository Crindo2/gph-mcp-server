---
date: 2026-09-26
source: worker
title: T3b test-file gate repair -- tests/caller-classification.test.mjs NUL byte
topics: [aeo, mcp, c409]
status: active
archived: false
---

# T3b -- CALLER-CLASSIFICATION-REPAIR test-file gate repair

Allocation: ALLOC-AEO-T3B-G99-81. Authority: C409 D2 (gph-mcp-server#14 NOT CLEAR).

## Defect confirmed

`tests/caller-classification.test.mjs` (11,712 bytes at commit d8dec41) contained exactly
one raw NUL byte at offset 7649, inside the adversarial user-agent probe array on source
line 143 (a `Mozilla` / raw-NUL / `a.repeat(4000)` probe list). A byte-level scan of the
full file (excluding TAB/LF/CR) found no other control bytes. `file` reported
`tests/caller-classification.test.mjs: data` before the fix. git's binary-blob heuristic
scans a blob for a NUL byte; any hit makes git treat that blob as binary for diff purposes,
which is why `git diff --numstat` against commit d8dec41 (or its parent, 046b82c, where
this file was added) reports `- -` and GitHub renders the PR diff as "ADDED WITH 0 LINES"
even though the file runs and passes 17 tests locally.

## Fix

Replaced the single raw NUL byte with the six-character JavaScript escape sequence for
U+0000 (a backslash, the letter u, then four zero digits) -- identical string value, zero
semantic change. No other byte in the file was touched. File grew from 11,712 to 11,717
bytes (net +5 bytes: -1 raw byte, +6 for the six-character escape).

Verified after the fix:
- `file tests/caller-classification.test.mjs` now reports `JavaScript source, Unicode text,
  UTF-8 text` (no longer `data`).
- A full byte scan of the fixed file found zero control bytes outside TAB/LF/CR.
- `node --test tests/caller-classification.test.mjs`: 17/17 pass, unchanged from before the fix.

## Known, unavoidable git limitation (do not overclaim)

`git diff d8dec41 --numstat -- tests/caller-classification.test.mjs` still reports `- -`
(binary) after the fix, and `git diff d8dec41 --stat` shows `Bin 11712 -> 11717 bytes` rather
than a line count. This is expected, not a failure of the fix: git's binary-diff heuristic is
evaluated per blob on *both* sides of a comparison, and the OLD side of this specific diff
(commit d8dec41's blob) still contains the original NUL byte forever, in history. No commit
made on top of d8dec41 can make a diff *against* d8dec41 render as text-with-line-counts,
short of rewriting or squashing history, which this allocation's scope forbids (commit-only,
no push/merge/deploy). A minimal repro (`git diff --no-index` on two throwaway files, one with
a raw NUL and one without) reproduces the same "Binary files differ" result, confirming this is
git's general behavior, not specific to this repo.

What the fix *does* verifiably achieve, and what actually matters for reviewability going
forward: the blob now committed at HEAD contains no NUL byte, so (a) GitHub's blob/file view of
this file at or after this commit will render it as text, and (b) every diff computed *from*
this commit forward -- e.g. this file's next edit, whenever that happens -- will render as
ordinary text with real line counts, since neither side of that future comparison touches the
NUL-bearing d8dec41 blob. This was confirmed directly: diffing the fixed HEAD blob against a
scratch copy with one appended line produced a normal unified diff (two lines added, a proper
`@@` hunk header), not a binary-files message. The one diff that will never render as text is
the historical one comparing directly against d8dec41 or 046b82c themselves.

## Mutation test (proves the 17 tests actually discriminate)

Built an isolated scratch copy (functions/mcp.js + functions/_shared/practice-size-vocab.js +
tests/caller-classification.test.mjs + tests/fixtures/caller-corpus.json) outside the repo, so
the real tracked `functions/mcp.js` was never touched (confirmed clean via `git status --short`
and `git diff --stat` after the mutation run).

Baseline: scratch copy, unmutated, 17/17 pass.

Mutation: in the scratch copy's `functions/mcp.js`, changed the `callerIdentity()` final
else-branch (the fallback branch the NUL-byte probe and other unmatched user-agents fall into)
from `caller_kind = 'unattributed'` to `caller_kind = 'unattributed_MUTATED'`.

Result: 14/17 pass, 3/17 fail. Failures included:
- `caller_kind is always one of the five declared values` -- direct hit on the fallback branch
  (fails for `actionist-tool-call-args` and any other unmatched UA, including the NUL probe).
- `every corpus user-agent resolves to exactly the expected kind and intent` -- byte-for-byte
  pin test caught the changed value.
- one further pinned-value assertion.

This confirms the suite is not vacuous: it fails when the exact code path the NUL-byte probe
exercises is broken.

## Commit

Committed only `tests/caller-classification.test.mjs` on `lane/t3b-tests-g99`, message citing
C409 D2. `git diff d8dec41 --stat` (equivalently `--name-only`) lists exactly that one path.
No push, merge, deploy, or migration was performed. No network access or secrets were used.
No email-shaped string was introduced; the file's existing redacted/example fixture addresses
(`redacted@example.invalid`, `someone@example.com`, and Anthropic's own public
`claudebot@anthropic.com` bot contact) were left untouched, as instructed.
