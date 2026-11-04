Program: GPH-PRACTICE-DATA-01
Stage: C1471-MCP-PRACTICE-DATA-COUNTS-REPAIR-1-REVERIFY
Ruling: ops/banked/C1471-G1-LIVE-NOW-BY-THE-DESK-SEATS-ON-THE-51-ROW-BOARD-LEDGER-WORKER-TAKES-OPERATIONS-2026-11-04.md@9ee3ce405202a689038bc91a4d1987be9b49ee3d
Role: VERIFIER
Requested model: sonnet

# BRIEF: cold re-verify of C1471-MCP-PRACTICE-DATA-COUNTS after repair 1 (C1471 s.4.2) (VERIFIER)

## Outcome
VERIFY_PASS or VERIFY_FAIL for Crindo2/gph-mcp-server branch `cloud/c1471-mcp-practice-data-counts-repair-1` at head `e8025f83374321d457b78f7836818f6142923742`, against CURRENT origin/main. On PASS the controller merges through merge_gate; the repo auto-deploys on push to main.

## What changed
- The first verify FAILED on two points:
  1. `segment` had a generic slug pattern, not the six endpoint slugs;
  2. `glama-release/tools.json` listed 5 tools.
- Repair 1 claims:
  - a six-slug enum (`primary-care`, `dental`, `pt-ot-speech`, `specialty-clinics`, `behavioral-health`, `derm-peds-vision-podiatry`) shared by the TOOLS schema and argument validation;
  - `list_categories` added to the Glama list;
  - 158 of 158 tests.

  Check these claims; do not trust them. The repair brief is `_c877_ref/BRIEF.md` on that branch.

## Check (one line each)
1. **Scope:** list every path the head changes against its merge base, excluding `_c877_ref`. It is expected to be within:
   - `functions/_shared/practice-data-counts.js`;
   - `functions/mcp.js`;
   - `tests/practice-data-counts.test.mjs`;
   - `tests/ehr-product-detail.test.mjs`;
   - `tests/serving-m1.test.mjs`;
   - `glama-release/tools.json`;
   - `mcp.json`;
   - `README.md`.
2. **The enum:**
   - exactly the six slugs above, in that order, in both the input schema and the validation;
   - an unknown slug is a tool error with zero fetch calls;
   - `state` keeps `^[A-Z]{2}$`;
   - `additionalProperties` is false.
3. **The tool otherwise, unchanged from the first verify:**
   - GET to `https://www.getpracticehelp.com/data/api/counts` with only the `state` and `segment` parameters;
   - no credentials, `redirect: "manual"`, a 10 s timeout;
   - non-200, timeout and network errors map to tool errors;
   - a suppressed cell passes through as null.
4. **Listings:**
   - `mcp.json`, `glama-release/tools.json` and the TOOLS array name the same six tools;
   - the `list_categories` Glama entry matches its TOOLS entry;
   - the README describes the new tool plainly: no records, and cells under 25 are not published.
5. **The other five tools behave as on origin/main.** The `functions/mcp.js` diff is additive. The byte-lock test change covers only the new or changed TOOLS entries.
6. **Tests:** run `node --test tests/*.test.mjs` and report the counts. Mutants, each of which must fail a test, then revert:
   - drop one slug;
   - accept an unknown slug;
   - fill a suppressed cell with 0;
   - follow redirects.
7. Do not call the live endpoint.

## Rules
- Read only. No network beyond git. Do not deploy, dispatch, publish, migrate, apply or merge.
- Commit and push only `_c877_ref` files to your packet branch.
- material_exception is a real JSON boolean.
- **The envelope MUST carry a top-level field `"head": "e8025f83374321d457b78f7836818f6142923742"`.**
- verified_blobs MUST include EVERY path the head changes against its merge base with origin/main, EXCLUDING every `_c877_ref` path, each with `git rev-parse <head>:<path>`; script it.
- verified_deletions: a JSON list of path strings, or [].
- No phone-number-shaped strings, emails or personal names in the envelope.
- Fresh non-author seat. independence_attestation {fresh_seat: true, read_from: [...], never_had_access_to: ["the builder lane", "the repair lane", "the first verify lane", "the controller session"]}.
- workspace: removed (state it in the envelope).
- Time box about 25 minutes. Return VERIFY_FAIL naming the step, not silence.
- ASCII only; write U+2014 as words.
