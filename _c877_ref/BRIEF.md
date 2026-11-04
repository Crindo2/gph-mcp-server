Program: GPH-PRACTICE-DATA-01
Stage: C1471-MCP-PRACTICE-DATA-COUNTS-REPAIR-1
Ruling: ops/banked/C1471-G1-LIVE-NOW-BY-THE-DESK-SEATS-ON-THE-51-ROW-BOARD-LEDGER-WORKER-TAKES-OPERATIONS-2026-11-04.md@9ee3ce405202a689038bc91a4d1987be9b49ee3d
Role: REPAIRER
Requested model: sonnet

# BRIEF: practice_data_counts, segment enum of the six endpoint slugs, and the Glama tool list complete (C1471 s.4.2; REPAIR 1) (REPAIRER)

## Outcome
Your packet branch is based on `cloud/c1471-mcp-practice-data-counts-b`. Its change commit is `7fe025ce8ceb325330ba1dd7ce944d6f85af1b48`, and the tip adds only the builder's envelope. Fix the two findings below and return NEEDS_VERIFY.

## The verify's findings (quoted from its return)
- "step2: segment has no 6-slug enum, only a generic slug pattern"
- "step4: glama-release/tools.json lists 5 tools (pre-existing omission of list_categories), brief expects 6"
- Everything else passed:
  - scope;
  - additive wiring;
  - byte-lock;
  - fetch rules;
  - error mapping;
  - null pass-through;
  - 154 of 154 tests;
  - all three mutants.

## The six slugs (controller read of the endpoint source)
The endpoint is getpracticehelp `workers/gph-practice-data-staging/src/fields.mjs` `SEGMENTS` on main. Exactly these six, in this order:
1. `primary-care`
2. `dental`
3. `pt-ot-speech`
4. `specialty-clinics`
5. `behavioral-health`
6. `derm-peds-vision-podiatry`

The endpoint rejects any other value.

## Do
1. **Enum:** in `functions/_shared/practice-data-counts.js` and the TOOLS input schema in `functions/mcp.js`, make `segment` an enum of exactly the six slugs above, replacing the generic pattern. Validate the argument against the same list before any fetch. An unknown slug is a tool error, and nothing is fetched.
2. **Glama list:** add the missing `list_categories` entry to `glama-release/tools.json` so it lists all six tools the server serves. Take its name and description from the server's TOOLS entry, verbatim. Confirm `mcp.json`, `glama-release/tools.json` and the TOOLS array name the same six tools, and add a test that asserts this.
3. **Tests:**
   - an unknown segment returns a tool error with no fetch call;
   - each of the six slugs passes validation.

   Mutant: drop one slug from the enum; a test must fail. Revert it.
4. **Run the suite:** `node --test tests/*.test.mjs`. Report the counts.

## Rules
- Only those files and tests. No network beyond git, no deploy, no PR, no merge.
- Commit your change FIRST, then the `_c877_ref` envelope as a separate LAST commit. The envelope's top-level `"head"` is the full sha of the commit containing your change. `changed_paths` lists every path your head changes against origin/main.
- material_exception is a real JSON boolean. ASCII only; no phone-number-shaped strings, emails or personal names.
- workspace: removed. Time box about 20 minutes.
