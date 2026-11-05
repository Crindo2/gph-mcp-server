Program: GPH-PRACTICE-DATA-01--COUNTS-DEFINITION
Stage: C1490-COUNTS-DEFINITION
Ruling: ops/banked/C1490-WEEKLY-GUIDE-TO-VENDOR-CLICK-READ-BY-VENDOR-RANK-AND-GUIDE-2026-11-05.md@9b531ee282ec65f2516663b0ed947635e3007fe6
Role: BUILDER
Requested model: sonnet

# BRIEF: practice_data_counts says exactly what it counts (C1490) (BUILDER)

## Outcome
A Crindo2/gph-mcp-server branch off CURRENT origin/main that changes the `practice_data_counts` tool description, its listings (`mcp.json`, `glama-release/tools.json`, README) and its tests. Return NEEDS_VERIFY. On PASS the repo auto-deploys on merge.

## Ruling (C1490, as relayed by the owner)
"the live practice_data_counts tool returns 1,226 TX behavioral health ('headline evidence', 262,012 nationally) while the Practice Data pages and the OmniMD deck say 7,628 and 507,423. Make the endpoint and MCP description say exactly what it counts, or serve the same counts the product pages use; report which and why."

## The decision (controller), and why
**Describe exactly; do not change the numbers.** The endpoint source (getpracticehelp `workers/gph-practice-data-staging/src/counts.mjs`, header comment) says it returns headline practices only, grouped by state and segment, with the C778 floor. It also says: "No totals (per state, per segment or national) and no lower-evidence counts are returned, because no ruling covers" them. The product pages' 507,423 is all records, including lower-evidence ones. Serving those would need a ruling the endpoint was built without. The endpoint response already carries `"unit": "practices (headline evidence)"`. The gap is in the MCP description, which does not say this.

## Do
1. **The tool description and the `unit` meaning** state plainly:
   - it counts practices with headline (strongest-tier) evidence only, by state and segment;
   - cells under 25 are not published (null);
   - it excludes lower-evidence records;
   - so its numbers are lower than the Practice Data product's all-record totals (507,423 nationally as published on the product pages);
   - no records or names are returned.

   Keep it short and factual. Mirror the same text in `mcp.json`, `glama-release/tools.json` and the README.
2. **No change** to the fetch URL, the input schema or how counts are returned. The six tools stay the same.
3. **Tests:**
   - update the byte-lock and listing tests for the new description only;
   - add a test that the description contains "headline" and "lower-evidence".
4. **Run tests:** `node --test tests/*.test.mjs`; report the counts.

## Rules
- Only the description text in `functions/_shared/practice-data-counts.js` (or wherever the TOOLS entry text lives), `mcp.json`, `glama-release/tools.json`, the README and tests. No network beyond git, no deploy, no PR, no merge.
- Commit your change FIRST, then the `_c877_ref` envelope as a separate LAST commit. The envelope's top-level `"head"` is the full sha of the commit containing the change. `changed_paths` lists every path changed against origin/main.
- material_exception is a real JSON boolean. ASCII only; no phone-number-shaped strings, emails or personal names.
- workspace: removed. Time box about 20 minutes.
