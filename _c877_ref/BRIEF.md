Program: GPH-PRACTICE-DATA-01
Stage: C1471-MCP-PRACTICE-DATA-COUNTS-VERIFY
Ruling: ops/banked/C1471-G1-LIVE-NOW-BY-THE-DESK-SEATS-ON-THE-51-ROW-BOARD-LEDGER-WORKER-TAKES-OPERATIONS-2026-11-04.md@9ee3ce405202a689038bc91a4d1987be9b49ee3d
Role: VERIFIER
Requested model: sonnet

# BRIEF: cold non-author verify of C1471-MCP-PRACTICE-DATA-COUNTS (C1471 s.4.2) (VERIFIER)

## Outcome
VERIFY_PASS or VERIFY_FAIL for Crindo2/gph-mcp-server branch `cloud/c1471-mcp-practice-data-counts-b` at head `7fe025ce8ceb325330ba1dd7ce944d6f85af1b48`, against CURRENT origin/main. On PASS the controller merges through merge_gate; the repo auto-deploys on push to main.

## Grounding (inside this lane)
The builder's brief is at `_c877_ref/BRIEF.md`; its claims are in `_c877_ref/return.json`. Check them; do not trust them.

## Ruling (quoted, C1471 s.4.2)
"Practice Data aggregate counts by state and segment: one tool on the GPH MCP server plus one JSON endpoint, exposing no records."

## Check (one line each)
1. **Scope:** list every path the head changes against its merge base (excluding `_c877_ref`). Report anything else. Expected:
   - `functions/_shared/practice-data-counts.js`;
   - `functions/mcp.js`;
   - `tests/practice-data-counts.test.mjs`;
   - `tests/ehr-product-detail.test.mjs`;
   - `tests/serving-m1.test.mjs`;
   - `glama-release/tools.json`;
   - `mcp.json`;
   - `README.md`.
2. **The tool:**
   - name `practice_data_counts`; optional `state` (pattern `^[A-Z]{2}$`) and `segment` (the 6 slugs the endpoint serves); `additionalProperties` false;
   - GET `https://www.getpracticehelp.com/data/api/counts` with only those query parameters, no credentials, `redirect: "manual"`, a 10 s timeout;
   - non-200, timeout and network errors map to a tool error, never a fabricated count;
   - a suppressed cell passes through as null.
3. **The other five tools** behave exactly as on origin/main. Diff `functions/mcp.js` and confirm the wiring is only additive. The byte-lock test update covers only the added TOOLS entry.
4. **Listings:** `glama-release/tools.json`, `mcp.json` and the README list six tools, describing the new one plainly: headline counts by state and segment, cells under 25 not published, no records.
5. **Tests:** run the repo's test command (from `.github/workflows/deploy.yml`, for example `node --test tests/*.test.mjs`); report counts. Mutants, each of which must fail a test, then revert:
   - drop the state pattern;
   - fill a suppressed cell with 0;
   - follow redirects.
6. Do not call the live endpoint.

## Rules
- Read only. No network beyond git. Do not deploy, dispatch, publish, migrate, apply or merge.
- Commit and push only `_c877_ref` files to your packet branch.
- material_exception is a real JSON boolean.
- **The envelope MUST carry a top-level field `"head": "7fe025ce8ceb325330ba1dd7ce944d6f85af1b48"`.**
- verified_blobs MUST include EVERY path the head changes against its merge base with origin/main, EXCLUDING every `_c877_ref` path, each with `git rev-parse <head>:<path>`; script it.
- verified_deletions: a JSON list of path strings, or [].
- No phone-number-shaped strings, emails or personal names in the envelope.
- Fresh non-author seat. independence_attestation {fresh_seat: true, read_from: [...], never_had_access_to: ["the builder lane", "the controller session"]}.
- workspace: removed (state it in the envelope).
- Time box about 25 minutes. Return VERIFY_FAIL naming the step, not silence.
- ASCII only; write U+2014 as words.
