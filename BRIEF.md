You are a cold, non-author VERIFIER for CBEG ops: allocation ALLOC-C1569-MCP-CV-G136-01, program GPH-MCP-SERVING-01, stage WKR-C1569-MCP-CV, worker WKR-C1569-MCP-CV-G136-01. Read only: never merge, deploy, dispatch a workflow, arm, send, write production data or open a PR. Do NOT call add_repo or any tool that asks for approval. Use no em dashes.

**Fresh seat:** read the builder's envelope (`_c877_ref/return.json` on its build/alloc-* envelope branch) only AFTER forming your own findings.

## Subject
Crindo2/gph-mcp-server branch `claude/c1569-mcp-count-source` at head `7d2648cb89b1ba957bc3528d6953372f6928f02a` (run `git fetch origin claude/c1569-mcp-count-source && git checkout 7d2648cb89b1ba957bc3528d6953372f6928f02a`). Compare against the repo's default branch. Changed paths:
- functions/_shared/attribution.js
- functions/_shared/practice-data-counts.js
- functions/mcp.js
- tests/ehr-product-detail.test.mjs
- tests/practice-data-counts.test.mjs
- tests/serving-m1.test.mjs

## What the builder claims
Item 2: practiceDataCounts() now returns count = number of published, non-suppressed cells; telemetry stores it and zero_result is 1 only when that is 0. Item 5: new functions/_shared/attribution.js; every successful tool response gains top-level source and url (utm_source=mcp, utm_medium=ai-assistant, utm_campaign=<tool>) plus one trailing text block; content[0] and the counts body are unchanged. Errors carry no citation. URLs: practice_data_counts -> /data/ (hub; not verified live, only /data/api/counts is known to the code), get_provider_detail -> /providers/<slug>/, match_practice -> /match/, other directory tools and get_ehr_product_detail -> /providers/. Three existing tests that pinned the old result key set or exact EHR result were updated to allow source/url. Item 3: no client, schedule or workflow in this repo calls match_practice, list_categories, practice_data_counts x3. Only workflows are gates.yml (PR) and deploy.yml (push to main); neither calls the MCP. The caller is NOT identifiable from this repo; production UA python-requests/2.x classifies as known_crawler/bot. The repo's internal marking is a User-Agent starting with cbeg- (classifyCaller and callerIdentity in functions/mcp.js, also verify-fix-organic and the Codex UA); if the script is ours, set its UA to e.g. cbeg-smoke/1 and it logs caller_class internal, caller_kind self_test. No code change made for it since the script is not in this repo. Item 4: not computed (no production data access). Deploy route: merge to main triggers .github/workflows/deploy.yml (node --test gate, wrangler pages deploy to Cloudflare Pages project gph-mcp-server, then reads back deployed commit_hash and fails if it differs from GITHUB_SHA). PRs need required check gates.

Boundary claimed: No merge, deploy, workflow dispatch, production write or PR. Brief branch untouched. No force-push.

## Check
1. Each claim above is true in the code. Name any claim that is false or overstated.
2. Safety:
   - dry-run or unarmed is the default and arming needs an explicit repository variable;
   - workflows have minimal `permissions`;
   - secrets are referenced by name only and fail clearly when absent;
   - no workflow input is interpolated unsafely into shell (`${{ inputs.x }}` inside `run:` is a defect; it must go through `env:`);
   - crons and timezone guards are correct for America/Chicago (CST from 11-01).
3. Tests: run the new tests and the repo's existing suite where feasible. Report counts. Make at least two mutations to core logic (revert a fix, flip a guard); a test must catch each. Report mutants and which test caught them.
4. Anything that would make this unsafe or wrong to merge to the default branch.
Ruling C1569. Top checks: practice_data_counts returns count = published non-suppressed cells and zero_result is 1 only when that is 0; the counts body (content[0]) is byte-unchanged; every successful tool response carries source and a url with utm_source=mcp&utm_medium=ai-assistant&utm_campaign=<tool>, and errors carry none; nothing else in responses changes; report the builder's python-requests caller finding and judge it. Mutation-test the count and the zero_result rule. Never deploy or call a live endpoint.

## Envelope (strict)
Write `_c877_ref/return.json` with these fields:
- "program_id": "GPH-MCP-SERVING-01", "stage_id": "WKR-C1569-MCP-CV", "allocation_id": "ALLOC-C1569-MCP-CV-G136-01", "worker_id": "WKR-C1569-MCP-CV-G136-01";
- "result": "VERIFY_PASS" or "VERIFY_FAIL";
- "summary", "property": "CBEG", "model_used";
- "boundary", "blocker" (null or a string), "material_exception" (a JSON boolean);
- "head": "7d2648cb89b1ba957bc3528d6953372f6928f02a";
- "verified_blobs": an object mapping each changed path above to its git blob id at that head (`git rev-parse 7d2648cb89b1ba957bc3528d6953372f6928f02a:<path>`);
- "verified_deletions": [];
- "evidence": a list of objects {"path","sha256"};
- "independence_attestation": an object {"fresh_seat": true, "read_from": [...], "never_had_access_to": ["any credential value"]};
- "mutants": a list of {"mutant","caught_by"};
- "return_branch": "verify/alloc-c1569-mcp-cv-g136-01".

Commit only that file on a NEW branch `verify/alloc-c1569-mcp-cv-g136-01` (based on 7d2648cb89b1ba957bc3528d6953372f6928f02a), push it with `git push -u origin verify/alloc-c1569-mcp-cv-g136-01`, and confirm with `git ls-remote origin verify/alloc-c1569-mcp-cv-g136-01`.
