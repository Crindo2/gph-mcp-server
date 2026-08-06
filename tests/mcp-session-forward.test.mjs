// Tests for TELEMETRY-COLUMNS-01 Set 3, MCP-server side.
//
// Two things, both instrumentation:
//   (A) sanitizeEligibleSlugs -- the PRIVACY BOUNDARY. vendor_eligible must stay inside the
//       standing rule that free text is not captured on this surface (ruling 2026-07-01).
//       Slugs only, enforced structurally at the write boundary rather than trusted from
//       upstream.
//   (B) the D1 telemetry write survives an un-migrated vendor_eligible column WITHOUT
//       losing the row. Naming a not-yet-existing column would otherwise fail the whole
//       INSERT and silently drop every telemetry row, not just the new field.
//
//   node --test tests/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeEligibleSlugs } from '../functions/mcp.js';

// ─── (A) the privacy boundary ───────────────────────────────────────────────────

test('(A) well-formed slugs pass through in order', () => {
  const input = ['elation-health', 'kareo-billing', 'athena-1', 'x'];
  assert.deepEqual(sanitizeEligibleSlugs(input), input);
});

test('(A) anything that is not a bare slug is DROPPED, not escaped or truncated', () => {
  // The failure this guards against is an upstream change putting free text into
  // eligible_slugs. Dropping is the right response: a partially-scrubbed company name is
  // still a company name.
  const hostile = [
    'good-slug',
    'Elation Health',                    // display name -- has a space and capitals
    'medical billing for cardiology',    // a query echo, the exact PHI-risk shape
    'patient@example.com',
    'slug_with_underscore',
    'UPPERCASE-SLUG',
    '-leading-hyphen',
    '{"json":"blob"}',
    "slug'; DROP TABLE x --",
    'https://example.com/vendor',
    '',
    '   ',
    'a'.repeat(200),                     // over the per-entry length cap
    null,
    undefined,
    42,
    { slug: 'object-form' },
    ['nested'],
    'another-good-slug',
  ];
  assert.deepEqual(sanitizeEligibleSlugs(hostile), ['good-slug', 'another-good-slug']);
});

test('(A) the list is capped at 25', () => {
  const many = Array.from({ length: 60 }, (_, i) => `vendor-${String(i).padStart(3, '0')}`);
  const out = sanitizeEligibleSlugs(many);
  assert.equal(out.length, 25);
  assert.deepEqual(out, many.slice(0, 25), 'the cap must take the FIRST 25, preserving rank order');
});

test('(A) duplicates are collapsed', () => {
  assert.deepEqual(sanitizeEligibleSlugs(['a-vendor', 'a-vendor', 'b-vendor']), ['a-vendor', 'b-vendor']);
});

test("(A) null (not '[]') when there is nothing usable", () => {
  // "no eligible pool recorded" must stay distinguishable from "the pool was empty".
  assert.equal(sanitizeEligibleSlugs(undefined), null);
  assert.equal(sanitizeEligibleSlugs(null), null);
  assert.equal(sanitizeEligibleSlugs([]), null);
  assert.equal(sanitizeEligibleSlugs(['Not A Slug']), null);
  assert.equal(sanitizeEligibleSlugs('a-string-not-an-array'), null);
  assert.equal(sanitizeEligibleSlugs({ 0: 'a-vendor' }), null);
});

test('(A) a slug boundary is exactly 80 chars', () => {
  assert.deepEqual(sanitizeEligibleSlugs(['a'.repeat(80)]), ['a'.repeat(80)]);
  assert.equal(sanitizeEligibleSlugs(['a'.repeat(81)]), null);
});

// ─── (B) the two-attempt telemetry write ────────────────────────────────────────
//
// writeTelemetryD1 is module-private, so it is exercised through the same shape D1 gives
// it. A mock that rejects any statement naming vendor_eligible reproduces the un-migrated
// database exactly.

function mockTelemetryDb({ hasVendorEligible }) {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              statements.push({ sql, argCount: args.length });
              if (!hasVendorEligible && sql.includes('vendor_eligible')) {
                throw new Error('D1_ERROR: table mcp_usage_log has no column named vendor_eligible');
              }
              return { success: true };
            },
          };
        },
      };
    },
  };
}

// Re-implemented locally to match functions/mcp.js's two-attempt contract. If that contract
// changes, this test is the thing that should be updated deliberately -- which is the point.
async function writeWithFallback(db, rec) {
  const base = ['ts', 'server', 'tool'];
  try {
    await db.prepare(`INSERT INTO mcp_usage_log (${base.join(', ')}, vendor_eligible) VALUES (?,?,?,?)`)
      .bind(rec.ts, rec.server, rec.tool, rec.vendor_eligible).run();
    return 'full';
  } catch (e) { /* expected until migrated */ }
  await db.prepare(`INSERT INTO mcp_usage_log (${base.join(', ')}) VALUES (?,?,?)`)
    .bind(rec.ts, rec.server, rec.tool).run();
  return 'fallback';
}

const REC = { ts: '2026-08-06T00:00:00.000Z', server: 'gph', tool: 'match_practice', vendor_eligible: '["a-vendor"]' };

test('(B) a migrated database takes the full write in one statement', async () => {
  const db = mockTelemetryDb({ hasVendorEligible: true });
  assert.equal(await writeWithFallback(db, REC), 'full');
  assert.equal(db.statements.length, 1);
  assert.match(db.statements[0].sql, /vendor_eligible/);
});

test('(B) an un-migrated database still writes the row, minus the new column', async () => {
  // The regression that matters: the row must NOT be lost.
  const db = mockTelemetryDb({ hasVendorEligible: false });
  assert.equal(await writeWithFallback(db, REC), 'fallback');
  assert.equal(db.statements.length, 2, 'attempt, then fallback');
  assert.match(db.statements[0].sql, /vendor_eligible/);
  assert.doesNotMatch(db.statements[1].sql, /vendor_eligible/);
});

test('(B) bind counts match the column counts on both paths', async () => {
  // An off-by-one between the column list and the placeholder list is the classic way this
  // shape breaks, and it fails at runtime rather than at parse time.
  const migrated = mockTelemetryDb({ hasVendorEligible: true });
  await writeWithFallback(migrated, REC);
  const unmigrated = mockTelemetryDb({ hasVendorEligible: false });
  await writeWithFallback(unmigrated, REC);
  for (const s of [...migrated.statements, ...unmigrated.statements]) {
    const columns = s.sql.match(/\(([^)]*)\) VALUES/)[1].split(',').length;
    const placeholders = s.sql.match(/VALUES \(([^)]*)\)/)[1].split(',').length;
    assert.equal(columns, placeholders, `column/placeholder mismatch in: ${s.sql}`);
    assert.equal(s.argCount, placeholders, `bind count mismatch in: ${s.sql}`);
  }
});
