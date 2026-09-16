-- GPH-MCP-SERVING-01 / M1-SERVING-BUILD (C161 s.2 as amended by C161-A s.4a)
-- Target: D1 gph-mcp-telemetry (binding TELEMETRY_DB, database_id e8605bbb-288e-4f45-b2fd-3a5333f21047)
--
-- STATUS: NOT APPLIED. Included in the PR for review; the controller applies it at merge.
--
-- ADDITIVE ONLY: two nullable ADD COLUMNs. No existing column is dropped, renamed, retyped or
-- repurposed (demand_cell and results_count are untouched). Existing rows read NULL for both --
-- NULL means "written before M1", not a classification. Historical rows are classified by the
-- window-level backfill (M3), which writes these columns and never overwrites the raw ones.
--
-- traffic_class: 'ingestion' | 'demand' | 'reference', set at write time from the call's own
--   shape by classifyTrafficClass() in functions/mcp.js.
-- cache_status:  'hit' | 'miss' | 'bypass' for search_providers; NULL for tools with no cache.
--
-- No CHECK constraint: the value set is enforced in code, and a CHECK in SQLite cannot be widened
-- later without a table rebuild.
--
-- Order-safe either way: functions/mcp.js falls back to the pre-M1 INSERT on "no column named",
-- so deploying before applying loses only the two labels, not the row.
--
-- Apply (controller, at merge):
--   npx wrangler d1 execute gph-mcp-telemetry --remote --file=migrations/2026_09_16_mcp_usage_log_traffic_class_cache_status.sql

ALTER TABLE mcp_usage_log ADD COLUMN traffic_class TEXT;
ALTER TABLE mcp_usage_log ADD COLUMN cache_status TEXT;
