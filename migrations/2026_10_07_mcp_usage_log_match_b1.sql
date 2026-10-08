-- C596 s.4 / C710 s.1: structured matching dimensions, additive only.
-- Target: gph-mcp-telemetry (TELEMETRY_DB). STATUS: NOT APPLIED.
-- Controller reviews/applies at the authorized deployment stage. No backfill.
-- NULL means absent or pre-B1; service_needs is JSON of the closed codes (including []).
-- The writer retries the existing M2/M1/base shapes on missing columns, preserving the row.
ALTER TABLE mcp_usage_log ADD COLUMN vendor_geo_preference TEXT;
ALTER TABLE mcp_usage_log ADD COLUMN service_needs TEXT;
