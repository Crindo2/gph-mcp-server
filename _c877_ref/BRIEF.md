Program: GPH-PRACTICE-DATA-01
Stage: C1471-MCP-PRACTICE-DATA-COUNTS
Ruling: ops/banked/C1471-G1-LIVE-NOW-BY-THE-DESK-SEATS-ON-THE-51-ROW-BOARD-LEDGER-WORKER-TAKES-OPERATIONS-2026-11-04.md@9ee3ce405202a689038bc91a4d1987be9b49ee3d
Role: BUILDER
Requested model: sonnet

# BRIEF: `practice_data_counts` tool on the GPH MCP server (C1471 s.4.2, product 1 of 2, part 2: the tool) (BUILDER)

## Outcome
A Crindo2/gph-mcp-server branch off CURRENT origin/main that adds a sixth tool, `practice_data_counts`, which reads the live public endpoint `https://www.getpracticehelp.com/data/api/counts`. Include tests. Return NEEDS_VERIFY.

## Ruling (quoted, C1471 s.4.2)
"Practice Data aggregate counts by state and segment: one tool on the GPH MCP server plus one JSON endpoint, exposing no records."

## The endpoint (LIVE; controller read-back 2026-11-04 14:00Z, Worker version fed353b2)
- `GET /data/api/counts` returns 200 with `Content-Type: application/json`, `Cache-Control: public, max-age=3600` and `Access-Control-Allow-Origin: *`.
- **Body:** `{schema_version: 1, as_of, unit: "practices (headline evidence)", min_cell: 25, states: [{state, segments: [{segment_code, segment_slug, label, count, suppressed}]}]}`.
  - 51 states and 306 cells; 4 cells suppressed (`count: null, suppressed: true`).
  - No totals and no record fields.
  - Example segment: `segment_code` "01_PRIMARY_CARE_AND_PHYSICIAN", `segment_slug` "primary-care".
- **Query filters:** `state` (two capital letters) and `segment` (one of the 6 slugs). A bad value returns 400; POST returns 405.

## Do (the existing EHR tool is the template: `functions/_shared/ehr-product-detail.js` and `tests/ehr-product-detail.test.mjs`)
1. **New `functions/_shared/practice-data-counts.js`:**
   - the tool definition `practice_data_counts`, described plainly as headline practice counts by US state and practice segment, with cells under 25 not published;
   - optional inputs `state` (pattern `^[A-Z]{2}$`) and `segment` (enum of the 6 slugs as served; read them from the live response shape above or the getpracticehelp Worker source, not invented), `additionalProperties: false`;
   - the call: GET the endpoint with those filters, no credentials, `redirect: "manual"`, a 10 second timeout. Return the JSON as the tool result. Map upstream errors and non-200 responses to a clear tool error, never a fabricated count.
2. **`functions/mcp.js`:** import the tool and register it in TOOLS, argument validation and the call dispatch, following exactly how `get_ehr_product_detail` is wired. Add telemetry only if the other tools record it.
3. **Tests** (`tests/practice-data-counts.test.mjs`, with fetch stubbed and no live network):
   - `tools/list` shows 6 tools including this one;
   - valid and invalid arguments;
   - the URL and query built;
   - upstream 400, 500 and timeout map to tool errors;
   - a suppressed cell passes through as null.
   - **Update** the byte-lock test in `tests/ehr-product-detail.test.mjs` and its fixtures for the new TOOLS block, and the tool count in `tests/serving-m1.test.mjs` (5 to 6). Change nothing else in them.
   - **Mutants**, each of which must fail a test, then revert:
     - drop the state pattern;
     - fill a suppressed cell with 0.
4. **Listings:** update `glama-release/tools.json`, the `mcp.json` tools array, `server.json` if it lists tools, and a short README section.
5. **Run** the repo's test command from `.github/workflows/deploy.yml` and report counts.

## Rules
- Only the files named above. No change to the other five tools' behaviour, the deploy workflow or any secret.
- No network beyond git, no deploy, no PR, no merge.
- Commit your change FIRST, then the `_c877_ref` envelope as a separate LAST commit. The envelope's top-level `"head"` is the full sha of the commit containing the change. `changed_paths` lists every path changed against origin/main.
- material_exception is a real JSON boolean. ASCII only in the envelope; no phone-number-shaped strings, emails or personal names.
- workspace: removed. Time box about 35 minutes.
