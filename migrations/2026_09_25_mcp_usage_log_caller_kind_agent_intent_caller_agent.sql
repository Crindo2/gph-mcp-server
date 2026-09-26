-- T3-CALLER-CLASSIFICATION-REPAIR (ALLOC-AEO-SPINE-T3-G99-34, C402-A item 4)
-- Target: D1 gph-mcp-telemetry (binding TELEMETRY_DB, database_id e8605bbb-288e-4f45-b2fd-3a5333f21047)
--
-- STATUS: NOT APPLIED. Included in the PR for review; the controller applies it at merge.
--
-- ADDITIVE ONLY: three nullable ADD COLUMNs. caller_class, traffic_class, cache_status and every
-- other column are untouched. Existing rows read NULL for all three -- NULL means "written
-- before this migration", not a classification. Historical rows are backfillable by the
-- identical write-time rules in callerIdentity() (functions/mcp.js), because classification is
-- UA+Origin only and network-free.
--
-- caller_kind:   'human' | 'model_agent' | 'bot' | 'self_test' | 'unattributed', set at write
--                time by callerIdentity() in functions/mcp.js. Exhaustive and mutually
--                exclusive -- the only dimension a published demand figure should be cut on.
-- agent_intent:  'end_user' | 'dev_tool', set only when caller_kind = 'model_agent'; NULL
--                otherwise. This is the field that separates real demand from build traffic
--                (dev_tool = a developer's own agent runtime calling the server, e.g. the
--                Codex CLI or Claude Code -- never organic end-user demand).
-- caller_agent:  the normalized, sanitised product token (e.g. 'openai-codex', 'claude-user',
--                'browser'), so a row names its caller instead of leaving the raw user_agent
--                as the only handle.
--
-- No CHECK constraint: the value set is enforced in code, and a CHECK in SQLite cannot be
-- widened later without a table rebuild (same rationale as the M1 migration).
--
-- Order-safe either way: functions/mcp.js (writeTelemetryD1) tries the widest column tier first
-- and falls back to the next-narrower tier on "no column named", so deploying before applying
-- this migration loses only these three labels, never the call record.
--
-- Apply (controller, at merge):
--   npx wrangler d1 execute gph-mcp-telemetry --remote --file=migrations/2026_09_25_mcp_usage_log_caller_kind_agent_intent_caller_agent.sql

ALTER TABLE mcp_usage_log ADD COLUMN caller_kind TEXT;
ALTER TABLE mcp_usage_log ADD COLUMN agent_intent TEXT;
ALTER TABLE mcp_usage_log ADD COLUMN caller_agent TEXT;
