# BRIEF -- AEO-MEASUREMENT-SPINE-BQ-01 T3b-CALLER-CLASSIFICATION-REPAIR-AND-DEPLOY (scoped: the test-file gate only; NO merge, NO deploy)
allocation_id: ALLOC-AEO-T3B-G99-81 | worker_id: claude-aeo-t3b-g99-81 | controller: GEN99
Authority: C409 D2 (gph-mcp-server#14 NOT CLEAR: tests/caller-classification.test.mjs shows "ADDED WITH 0 LINES" in the PR while the
RUNBOOK cites 17 tests). lane: C:/Code/_wt/gph-mcp-t3b-g99 (cwd), branch lane/t3b-tests-g99 at d8dec41 (= PR #14 head). You run as the
owner user and MAY commit on this branch; DO NOT push, merge, deploy or apply any migration. NO network, NO secrets. Never an email-shaped
string (the fixtures were redacted in d8dec41 -- keep them so). Write your report + return under `_t3b/`.
## CONTROLLER DIAGNOSIS (verify it yourself first)
The file is 11,712 bytes and runs 17/17 locally, but contains ONE raw NUL byte (offset ~7649, inside a string literal in an adversarial
user-agent list: `..., 'Mozilla', '<NUL>', 'a'.repeat(4000)`). git classifies the file as BINARY (numstat "- -"), so GitHub renders
"0 lines" and the gate is invisible to a reviewer.
## DO
1. Replace the raw NUL byte with the JS escape `\u0000` (identical string value). No other change to the file. Show `git diff --numstat`
   now reports line counts (text, not binary) and `file` no longer says "data"; scan for any other control byte.
2. Run `node --test tests/caller-classification.test.mjs`: 17/17. Mutation: in a scratch copy, break the classifier on the NUL input
   (or one other fixture branch) and show a test fails; record the transcript.
3. Commit ONLY tests/caller-classification.test.mjs with a message naming C409 D2. `git diff d8dec41 --stat` must list exactly that file.
4. `_t3b/T3B-TESTFILE.md` (frontmatter: date, source: worker, title, topics [aeo, mcp, c409], status: active, archived: false).
## RETURN -- UTF-8 WITHOUT a BOM, ASCII ONLY; summary a STRING; findings a LIST OF STRINGS; boundary, blocker STRINGS; material_exception BOOLEAN; NO email-shaped strings
Path: `C:/Code/_wt/gph-mcp-t3b-g99/_t3b/ALLOC-AEO-T3B-G99-81-return.json`
Keys (ALL top-level): program_id `AEO-MEASUREMENT-SPINE-BQ-01`; stage_id EXACTLY `T3b-CALLER-CLASSIFICATION-REPAIR-AND-DEPLOY`; worker_id
EXACTLY `claude-aeo-t3b-g99-81`; allocation_id EXACTLY `ALLOC-AEO-T3B-G99-81`; result NEEDS_VERIFY / BLOCKED-RETRYABLE; summary; evidence
[{path, sha256}] (non-empty); boundary; blocker; material_exception; findings; changed_paths; branch_or_worktree "lane/t3b-tests-g99 @ <sha>";
access_mode "lane commit only; no push; no network; no secrets"; property "C409 D2 test-file gate". Foreground; never end before the return
is written. Do not commit BRIEF.md or last-message.txt.
