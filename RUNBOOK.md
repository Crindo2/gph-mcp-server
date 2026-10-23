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

## Telemetry: caller_kind, agent_intent, caller_agent

`mcp_usage_log` gains three more nullable columns in `migrations/2026_09_25_mcp_usage_log_caller_kind_agent_intent_caller_agent.sql` (T3-CALLER-CLASSIFICATION-REPAIR, ALLOC-AEO-SPINE-T3-G99-34). The T3 migration is additive; C812 s.3 separately updates the caller_class rule below.

- **The defect this repairs:** `caller_class`'s `organic_assistant` value is the one the nightly rollup reads as organic demand, but it cannot distinguish a person asking an assistant from a developer's own agent tooling calling the server (e.g. the OpenAI Codex CLI, which sends a UA `assistantFromUA` matches). It also has no `human` value at all -- a real browser UA falls through to `unknown` alongside generic HTTP clients.
- `caller_kind`: `human` | `model_agent` | `bot` | `self_test` | `unattributed`, set at write time by `callerIdentity()` in `functions/mcp.js`. Exhaustive and mutually exclusive -- the only dimension a published demand figure should be cut on. `unattributed` asserts identity could not be established; it is deliberately not `unknown`, which reads as maybe-human.
- `agent_intent`: `end_user` | `dev_tool`, set only when `caller_kind = 'model_agent'`; NULL otherwise. `dev_tool` is a developer's own agent runtime (Codex, Claude Code, Cursor, an SDK, ...) and must be excluded from any organic/end-user demand figure.
- `caller_agent`: the normalized, sanitised product token (e.g. `openai-codex`, `claude-user`, `browser`), bounded to 40 chars and never raw user-agent text.
- Network-free and deterministic at write time (UA + Origin only), like `traffic_class`. Historical rows are backfillable by the identical rules (M3-style, not run here).
- **Gate:** `tests/caller-classification.test.mjs`, 17 tests fixtured on all 43 distinct user-agents in the production `mcp_usage_log` corpus (3,922 rows, read 2026-09-11) -- including historical legacy pins and explicit C812 `internal` overrides; other caller classes and all T3 identity dimensions retain their rules.
- Airtable mirror gains `Caller Kind`, `Agent Intent`, `Caller Agent`. `typecast` auto-creates a missing select *option* but not a missing *field* -- an unknown field name 422s the whole record -- so `logToolCall` retries once with the stable core alone on `UNKNOWN_FIELD_NAME` and logs it. A schema lag costs the three new columns, never the row.
- **Apply order:** either order is safe. `writeTelemetryD1` tries columns widest-first (base + M1 + this migration) and falls back a tier at a time on "no column named", so deploying before applying loses only the newest labels, never the row.

## Telemetry: internal caller_class (C812 s.3)

`caller_class` values are `internal` | `organic_assistant` | `known_crawler` |
`directory_probe` | `self_test` | `unknown`. The existing TEXT column accepts `internal`;
no column migration or access gate is added. D1 and the Airtable mirror receive the
same write-time value through the existing telemetry path (Airtable uses typecast).

After trimming the UA, the case-insensitive internal rule matches:
- the prefix `openai-mcp/1.0.0 (Codex)` (including appended seat/version text);
- the prefix `cbeg-`, which the existing code identifies as our own harness, including probes;
- exactly `verify-fix-organic`, identified as a literal test by the code and corpus.

This rule runs before assistant Origin, probe and assistant UA classification. It affects
caller_class only: caller_kind, agent_intent, caller_agent and traffic_class keep their rules.
Bare `openai-mcp/1.0.0` remains `organic_assistant`: dev_tool identifies a runtime, not estate
ownership. `Claude-User` remains `organic_assistant` with end_user intent. Generic HTTP
clients and other developer tooling are not assumed ours.

The nightly rollup's organic input is `caller_class = 'organic_assistant'`; internal rows
must be excluded even when traffic_class is demand. Existing ingestion and historical-sweep
exclusions still apply. No rollup source or enum is in this repository: the controller must
verify cbeg-mcp-rollup's organic filter and any closed caller_class lists accept/exclude internal.
No downstream deployment or natural-run acceptance is claimed by this server build.

Historical reclassification is ONE parameterized UPDATE, provided for the controller only:

```sql
-- C812 s.3; controller-only historical reclassification. NOT EXECUTED on D1.
-- Bind ?1='internal', ?2='openai-mcp/1.0.0 (Codex)%', ?3='cbeg-%', ?4='verify-fix-organic'.
-- SQLite/D1 default LIKE is ASCII case-insensitive, matching the UA rule.
-- TRIM removes surrounding spaces, as at write time; HTTP header values are normalized.
UPDATE mcp_usage_log
SET caller_class = ?1
WHERE (TRIM(user_agent) LIKE ?2
    OR TRIM(user_agent) LIKE ?3
    OR TRIM(user_agent) LIKE ?4)
  AND (caller_class IS NULL OR caller_class <> ?1);
```

Expected matches in the supplied 2026-09-11 corpus: **610 rows** = 433 Codex + 176 cbeg
harness + 1 verify-fix-organic. All 610 need changing on the original corpus, and a repeat
update changes 0. The retained legacy UA-only organic count is 672; after C812 it is 239.
The corpus notes that verify-fix-organic's stored class was organic because of its Origin,
so that row also leaves the stored organic series. The fixture does not specify every
stored Origin-dependent class; the 239 figure is the UA-only expected organic count.

These are fixture counts, not current production counts. The brief's later controller read
has 1,930 Codex and 1 verify-fix-organic organic rows: **1,931 known organic rows** would move,
leaving 281 organic rows (271 bare OpenAI MCP + 10 Claude-User). The current total affected
rows also includes cbeg traffic in other classes and cannot be derived from that aggregate.
The controller must read back actual affected counts and the C812 rows 7483 and 7520-7524;
this worker makes no D1 write, historical rollup recompute or Airtable historical rewrite.


## Row 16 MCP monetization boundary (staging only)

C785 s.1/s.3, C787 s.3 and C1082 row 16: this build is uncommitted and
requires independent verification before controller promotion. No deploy or
migration is performed. The default configuration emits no Quotes link.

To exercise a separately built S3 staging form, set BOTH:
- `MCP_GET_QUOTES_ENABLED=1` (only this literal string enables links).
- `MCP_GET_QUOTES_URL=https://<staging-project>.pages.dev/<form-path>/`.

The URL must be HTTPS on a pages.dev subdomain with no credentials, port,
query or fragment. There is deliberately no presumed production destination.
S3 must provide the actual form route; this MCP build does not create it.
`match_practice` appends `vendor=<slug>&source=mcp`. Opening the link is only
navigation; S3 owns vendor selection, named consent, POST confirmation,
withdrawal and dispatch-time eligibility checks. MCP attribution stays
separate from browser experiment assignment.

Upstream integration contract (new, fail closed until S3 provides it): a match
row needs `quotes_contact_deliverable: true` and `quotes_contact_source` equal
to `claimed_profile` or `verified_sales`. These are server-derived public
eligibility assertions, never arguments from the tool caller. A claimed or
verified directory badge alone is insufficient. S3 must revoke the assertion
when the contact becomes undeliverable/stale. No email/contact value is put in
the link or tool response. Missing eligibility, configuration or a safe slug
suppresses only the Quotes line; existing website/profile links remain.

Sponsored ENTRY markers accepted by the MCP boundary are `sponsored` or
`is_sponsored` equal to true, 1 or '1', or `entry_type`/`placement_type` equal
to 'sponsored'. Upstream must mark placement rows with this contract. Rows
are filtered before match top-five selection, numbering and telemetry IDs;
search cache hits use the same filter. A sponsored-only detail record is
returned as not found. Separate sponsored arrays are never rendered. Vendor
membership/payment fields do not suppress an independently organic record.
When a mixed page is filtered, its reported count is only the visible organic
cohort, because the upstream total cannot establish a full organic total.
Upstream geography and service-need summaries are suppressed for a mixed
shortlist because their computation may include paid entries. Without sponsored
entries, upstream counts and response bytes stay unchanged.

Structured private inquiry containers and known inquiry fields are removed
at the upstream JSON boundary, including the EHR projection that otherwise
returns raw JSON. Public profile rendering continues to use its existing
field selection. This is not an inquiry service or a substitute for keeping
private records out of the public API. No person-level inquiry store is read.
C812's existing internal classifier is retained: estate Codex, cbeg harness
and the known test string remain `internal`, excluded from the rollup's
`organic_assistant` population. Historical row backfill and external rollups
are outside this offline build.

Validation: `node --test tests/*.test.mjs`. The row16-baseline fixture contains
six complete responses captured from the unmodified 15db34e worktree before
this change (including nonempty/empty match and found/missing detail). The
new suite compares serialized responses through callTool and serveTool for
absent, empty and disabled configurations; it also covers enabled eligibility,
unsafe URLs, sponsored markers/cache hits, privacy and internal telemetry.
