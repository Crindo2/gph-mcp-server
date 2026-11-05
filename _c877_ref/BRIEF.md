Program: GPH-PRACTICE-DATA-01--COUNTS-DEFINITION
Stage: C1490-COUNTS-DEFINITION-VERIFY
Ruling: ops/banked/C1490-WEEKLY-GUIDE-TO-VENDOR-CLICK-READ-BY-VENDOR-RANK-AND-GUIDE-2026-11-05.md@9b531ee282ec65f2516663b0ed947635e3007fe6
Role: VERIFIER
Requested model: sonnet

# BRIEF: cold verify of the practice_data_counts description change (C1490) (VERIFIER)

## Outcome
VERIFY_PASS or VERIFY_FAIL for Crindo2/gph-mcp-server branch `cloud/c1490-counts-definition` at head `945af896181024ca034b4c1ae2f340e3b189d5ad`, against CURRENT origin/main. On PASS the controller merges through merge_gate; the repo auto-deploys on push to main.

## Ruling and decision
- **C1490, relayed:** "Make the endpoint and MCP description say exactly what it counts, or serve the same counts the product pages use; report which and why."
- **The decision:** describe exactly.
- **Why:** the endpoint (getpracticehelp `workers/gph-practice-data-staging/src/counts.mjs`) counts headline-evidence practices only, under the C778 floor. Its source says lower-evidence counts are not returned "because no ruling covers" them. The product pages' 507,423 is every record.
- **Provided:** the live endpoint returns `"unit": "practices (headline evidence)"`.

## Check (one line each)
1. **Scope:** exactly `README.md`, `functions/_shared/practice-data-counts.js`, `glama-release/tools.json` and `tests/practice-data-counts.test.mjs` change, excluding `_c877_ref`.
2. **Only the description text changes:**
   - the fetch URL, query parameters, input schema (six-slug enum, state pattern), timeout, redirect handling and response handling are byte-identical to origin/main;
   - diff the file, and name any non-description change.
3. **The description says:**
   - headline (strongest-tier) evidence only, by state and segment;
   - cells under 25 are not published (null);
   - lower-evidence records are excluded;
   - the numbers are lower than the product's all-record totals;
   - no records or names.

   It claims nothing else as fact. Quote it.
4. **Listings agree:** the README and `glama-release/tools.json` carry the same text as the TOOLS entry. `mcp.json` lists the name only, which needs no change; confirm that.
5. **Tests:** run `node --test tests/*.test.mjs` and report the counts. Mutant: remove "lower-evidence" from the description; the new test must fail. Revert it.

## Rules
- Read only. No network beyond git. Do not deploy, dispatch, publish, migrate, apply or merge.
- Commit and push only `_c877_ref` files to your packet branch.
- material_exception is a real JSON boolean.
- **The envelope MUST carry a top-level field `"head": "945af896181024ca034b4c1ae2f340e3b189d5ad"`.**
- verified_blobs MUST include EVERY path the head changes against its merge base with origin/main, EXCLUDING every `_c877_ref` path, each with `git rev-parse <head>:<path>`; script it.
- verified_deletions: a JSON list of path strings, or [].
- No phone-number-shaped strings, emails or personal names in the envelope.
- Fresh non-author seat. independence_attestation {fresh_seat: true, read_from: [...], never_had_access_to: ["the builder lane", "the controller session"]}.
- workspace: removed (state it in the envelope).
- Time box about 15 minutes. Return VERIFY_FAIL naming the step, not silence.
- ASCII only; write U+2014 as words.
