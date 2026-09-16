# gph-mcp-server runbook

Operational notes for the GPH Intelligence MCP server (`functions/mcp.js`, Cloudflare Pages project `gph-mcp-server`). Merges to `main` auto-deploy.

## Rate controls: purpose

<!-- >>> RATE-CONTROL PURPOSE BEGIN >>> -->
RATE-CONTROL PURPOSE (C161-A s.3, owner ruling 2026-09-16, as corrected by C164 s.1(b)). The
public GPH vendor directory is intentionally enumerable: anonymous agents may read every page of
every category, and a legitimate agent may ingest the ENTIRE public provider corpus, not merely
one category. Rate controls in this server (the anonymous per-IP request-rate valve, its daily
backstop and the per-call row ceiling) exist ONLY for infrastructure safety, pathological
traffic, denial-of-service and resource exhaustion, and unexpected cost containment. They are
NEVER an anti-enumeration product boundary. They limit request RATE, not the total read: a
full-corpus ingest from one egress at the permitted rate is never refused, and the daily
backstop is sized above a full-corpus ingest with headroom. A refusal is operational only (rate
exceeded, retry after N seconds) and never points to paid access. Do not add, re-key or tighten
a control (ASN, organisation or category-level throttle, total cap below a full-corpus ingest,
page cap, hidden count) for the purpose of preventing or materially slowing full-corpus
ingestion. ASN and organisation may be recorded as telemetry only. Caching is the primary
economic control: repeat reads are made cheap by the search_providers read cache, not by
refusing them.
<!-- <<< RATE-CONTROL PURPOSE END <<< -->

The same text sits above `RATE_WINDOW_SECONDS` in `functions/mcp.js`. `tests/serving-m1.test.mjs` fails if the two copies diverge.

## Anonymous request-rate valve

- **Valve:** `RATE_LIMIT_PER_WINDOW = 120` calls per IP per fixed `RATE_WINDOW_SECONDS = 60` window, keyed `ip_rate:<ip>:<window start epoch s>` in `CALL_METER` (TTL 120 s). That is 2 calls/s sustained.
- **Daily backstop:** `DAILY_BACKSTOP = 20,000` calls per IP per UTC day, keyed `ip_daily:<ip>:<YYYY-MM-DD>` (TTL 48 h). It guards against DoS and runaway cost only.
- **Refusal:** a tool result with `isError: true`, a structured `retry_after_seconds`, and operational text only: "Rate limit exceeded: ... Retry after N seconds." It carries no pointer to paid access.
- **Legacy keys:** a valid key within its plan skips the valve. An exhausted, unknown or canceled key uses the anonymous valve. It is never hard-blocked.
- **KV fault:** the valve fails open. A meter fault never refuses a read.

### Sizing (measured 2026-09-16)

| Quantity | Value |
|---|---|
| Corpus (`/api/categories`) | 25 categories, 74,993 providers |
| Category-only pages at 25/page, summed per category | 3,010 (largest: Healthcare Legal Services, 7,380 providers, 296 pages) |
| Full-corpus ingest | 3,010 `search_providers` + 1 `list_categories` = 3,011 calls |
| Time at the valve's ceiling (120/min) | 3,011 / 120 = 25.1 min from one egress |
| Time at 1 call/s | 50.2 min |
| Same walk under the old 100/IP/day cap | 31 days |
| Live latency (G78-47) | 1.34 s miss, 0.47 s and 0.43 s hit |
| D1 per uncached full-corpus ingest (upper estimate, COUNT and OFFSET treated as scans) | ~19.2M rows read, ~6,022 rows written. Workers Paid includes 25B read and 50M written per month (0.08% and 0.01%). |
| Backstop headroom | 20,000 / 3,011 = 6.6x a full-corpus ingest (3.3x if the corpus doubles). Reachable only after 166.7 min at the ceiling. |

At the ceiling one IP generates 2 upstream Function invocations and about 6 D1 statements per second. The tightest shared limit on the path is the Airtable telemetry mirror, at 5 requests/s per base. It is non-blocking, and D1 remains the log of record.

### Substrate limits

Workers KV is eventually consistent. It allows at most 1 write per second to the same key, and `expirationTtl` must be at least 60 s. A put on every call could never record more than about 60 calls/min on one key, so the counter could not reach the limit. Each isolate therefore keeps a local count per window key and writes KV at most once per second per key. A burst served by one isolate is refused exactly. A burst spread across isolates or locations is counted on a best-effort basis. Exact cross-location counting would need a Durable Object or a rate-limiting binding. Either one is a binding change and outside this stage.

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
  - `pathological_rate`: the one row written for the first rate-valve refusal per IP per window (per isolate). Later refusals in that window write no row and skip Airtable. No schema change: it is a new value in the existing TEXT column. It is derived from rate only. Telling abusive traffic apart from an over-eager legitimate ingester would need window-level evidence (M3).
- **Limits:** a single call cannot see a traversal. A human's category-only first look is classed `ingestion`, and a sweep that adds a filter is classed `demand`. Page coverage, sequence, repeat passes and the self-reported user agent are not consulted. Window-level reclassification is M3.
- The Airtable mirror is unchanged. D1 is the log of record.
- **Apply order:** either order is safe. If the code is live first, the writer falls back to the pre-M1 column set and logs `migration not applied`.
