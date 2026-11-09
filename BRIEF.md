You are a BUILDER for CBEG ops.
- Allocation ALLOC-C1569-MCP-G136-01; program C1552-S3-DATA-APP-DEEPLINK; stage C1569-MCP-COUNT-AND-SOURCE; worker WKR-C1569-MCP-G136-01.
- Tier: Sonnet.

## Limits
- Never merge, deploy, dispatch a workflow, write production data, or open a PR.
- Do NOT call add_repo or any tool that asks for approval. Never force-push. Use no em or en dashes in docs.

## The ruling you are implementing (verbatim)
# C1569: practice_data_counts logs 0 results because the tool never reports a count

1. **The defect.** `practiceDataCounts()` returns the counts body without a `count`. So telemetry stores a null result count, and the Airtable log shows 0 even though callers get the full table. This is a logging defect, not empty data.
2. **The fix (smallest change).** Have the tool report a count: the number of published, non-suppressed cells it returned. Telemetry then records the real number, and `zero_result` is 1 only when nothing was published. Nothing else changes.
   - Add a test.
   - Builder plus cold verify, merge, and deploy gph-mcp-server by its normal route.
   - Read back the first live log row with a non-zero count.
3. **The python-requests caller.** Identify the script that calls match_practice, then list_categories, then practice_data_counts three times, every few hours.
   - If it is ours (a smoke test or monitor), mark its calls as internal the same way other internal callers are marked, so the log does not read as outside usage.
   - If it is not ours, say what it is.
4. **Backfill is optional:** corrected counts on old rows are not needed. Do record, in the tick, how many practice_data_counts calls since 11-04 came from callers that are not internal.
5. **Attribution (owner question, 11:02 CST).** MCP responses carry no source line or link today. The counts body is only the JSON table. So an assistant that uses our numbers has nothing to cite.
   - Add to every gph-mcp-server tool response, practice_data_counts first, a short `source` field, "GetPracticeHelp Practice Data" (or "GetPracticeHelp" for directory tools), plus a `url` to the matching public page. Tag the URL `utm_source=mcp&utm_medium=ai-assistant&utm_campaign=<tool name>`.
   - Assistants pass citations along more often when the response hands them one. The UTM then shows click-throughs from AI answers in our own analytics, separate from crawler traffic.
   - Same builder and verify as item 2. Do not change the counts body itself.
   - Bing Webmaster Tools' AI Performance report counts Copilot citations of our crawled pages, not MCP calls. It stays the read for page citations, alongside the weekly AI-visibility panel (board row 26).

## Build (Crindo2/gph-mcp-server, branch `claude/c1569-mcp-count-source`, from the default branch)
1. **Item 2:** `practiceDataCounts()` reports `count`, meaning the number of published, non-suppressed cells returned. Telemetry then stores it, and `zero_result` is 1 only when nothing was published. Add a test.
2. **Item 5:**
   - Every tool response gains a `source` field ("GetPracticeHelp Practice Data" for practice-data tools, "GetPracticeHelp" for directory tools) and a `url` to the matching public page. Tag it `utm_source=mcp&utm_medium=ai-assistant&utm_campaign=<tool name>`.
   - Do not change the counts body itself.
   - Choose the matching public URL per tool from what the code already knows (category, state, provider slug). Fall back to the closest hub page.
   - Add tests.
3. **Item 3:** find the python-requests caller.
   - Search this repo, and any workflow or script you can read in this repo, for a client that calls `match_practice`, then `list_categories`, then `practice_data_counts` three times on a schedule.
   - Report what you find: the file, the schedule, and whether it is ours.
   - If the repo has an existing "internal caller" marking (header, user agent or token), show how this caller would be marked. Implement the marking only if it is in this repo.
4. **Tests:** run the repo's suites, and report the counts. Mutation-test the count field and the zero_result rule yourself.

## Envelope (strict)
- Push to `claude/c1569-mcp-count-source`.
- Write `_c877_ref/return.json` on a NEW branch `build/alloc-c1569-mcp-g136-01` with:
  - `"program_id": "C1552-S3-DATA-APP-DEEPLINK"`
  - `"stage_id": "C1569-MCP-COUNT-AND-SOURCE"`
  - `"allocation_id": "ALLOC-C1569-MCP-G136-01"`
  - `"worker_id": "WKR-C1569-MCP-G136-01"`
  - `"result": "NEEDS_VERIFY"`
  - `"head"`
  - `"changed_paths"`
  - `"verified_blobs"`: {path: blob}
  - `"evidence"`: [{"path", "blob"}]
  - `"summary"`: include the item 3 finding and the normal deploy route for this repo
  - `"tests"`
  - `"boundary"`
  - `"blocker"`: ""
  - `"material_exception"`: false
  - `"model_used"`
  - `"property"`: "GPH"
  - `"return_branch"`: "claude/c1569-mcp-count-source"
