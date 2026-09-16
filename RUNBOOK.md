# gph-mcp-server runbook

Operational notes for the GPH Intelligence MCP server (`functions/mcp.js`, Cloudflare Pages project `gph-mcp-server`). Merges to `main` auto-deploy.

## Rate controls: purpose

<!-- >>> RATE-CONTROL PURPOSE BEGIN >>> -->
RATE-CONTROL PURPOSE (C161-A s.3, owner ruling 2026-09-16). The public GPH vendor directory is
intentionally enumerable: anonymous agents may read every page of every category. Rate
controls in this server (the anonymous per-IP daily meter, the per-call row ceiling and the
legacy keyed quotas) exist ONLY for infrastructure safety, pathological traffic,
denial-of-service and resource exhaustion, and unexpected cost containment. They are NEVER an
anti-enumeration product boundary. A legitimate agent must remain able to ingest a complete
category. Do not add, re-key or tighten a control (ASN, organisation or category-level
throttle, page cap, hidden count) for the purpose of preventing or materially slowing
full-category ingestion. ASN and organisation may be recorded as telemetry only. Repeat reads
are made cheap by the search_providers read cache, not by refusing them.
<!-- <<< RATE-CONTROL PURPOSE END <<< -->

The same text sits above `DAILY_LIMIT` in `functions/mcp.js`. `tests/serving-m1.test.mjs` fails if the two copies diverge.

## search_providers read cache

- **What:** the upstream `/api/search` JSON body for successful responses. The tool text is rendered fresh on every call.
- **Key:** `searchCacheKey(args)`, the effective query as `/api/search` parses it. `state` and `tier1_grade` are upper-cased, `city` is slugified, and `min_rating` counts only when it is above 0. `per_page` and `page` are keyed as the integers the upstream reads. `category` and `practice_size_fit` are keyed verbatim.
- **Store:** the Workers Cache API, `caches.open('gph-mcp-search-v1')`. It is per data center and not tiered.
- **TTL:** `SEARCH_CACHE_TTL_SECONDS = 3600`. The code enforces it with the `x-gph-cached-at` header on each entry. An older entry, or one with a missing or future timestamp, counts as a miss.
- **Freshness bound:** any write to D1 `providers` reaches every caller within 1 hour. That includes the daily "Sync Airtable and Deploy GPH" run (11:00 UTC) and the writers outside it. No sync-triggered purge exists, so the TTL is the bound.
- **Invalidate now:** rename `SEARCH_CACHE_NAME` and the key base version (`v1` to `v2`) and deploy. Otherwise wait out the TTL.
- **Faults:** if the store is unavailable or throws, the call is served uncached (`cache_status = 'bypass'`). A cache fault never refuses a read.
- **Unchanged:** `count` is returned, `page` has no maximum, and metering runs before the cache as before.
- **Side effect:** a cache hit does not reach `/api/search`, so getpracticehelp `search_queries` gets one row per miss, not one per MCP call. `mcp_usage_log` remains the per-call record.

## Telemetry: traffic_class and cache_status

`mcp_usage_log` (D1 `gph-mcp-telemetry`) gains two nullable columns in `migrations/2026_09_16_mcp_usage_log_traffic_class_cache_status.sql`. Both are additive.

- `cache_status`: `hit` | `miss` | `bypass` on `search_providers`; NULL for other tools.
- `traffic_class`, classified at write time:
  - `demand`: `get_provider_detail`, `match_practice`, or `search_providers` with any applied filter (`state`, `city`, `min_rating` > 0, `tier1_grade`, `practice_size_fit`).
  - `ingestion`: `search_providers` with category only.
  - `reference`: `list_categories`.
- **Limits:** a single call cannot see a traversal. A human's category-only first look is classed `ingestion`, and a sweep that adds a filter is classed `demand`. Page coverage, sequence, repeat passes and the self-reported user agent are not consulted. Window-level reclassification is M3.
- The Airtable mirror is unchanged. D1 is the log of record.
- **Apply order:** either order is safe. If the code is live first, the writer falls back to the pre-M1 column set and logs `migration not applied`.
