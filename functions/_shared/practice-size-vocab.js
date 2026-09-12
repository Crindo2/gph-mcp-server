// Practice-size vocabulary -- THE ONE closed set and the projection of both stored columns
// onto it. GPH-ENRICH-C1-VOCAB-PROVENANCE-01 (C77-c; parent GPH-VENDOR-ENRICHMENT-01).
//
// This file is DUPLICATED byte-for-byte in Crindo2/getpracticehelp
// (functions/_shared/practice-size-vocab.js) and Crindo2/gph-mcp-server
// (functions/_shared/practice-size-vocab.js). The two repos do not share a module. The
// sentinel-delimited block below is pinned by SHA-256 in tests/fixtures/practice-size-
// vocab.lock.json in BOTH repos (tests/practice-size-vocab.test.mjs), the same mechanism
// that holds ENRICHMENT-RESOLVER-V2 identical. Edit it in both repos in the same change.
// >>> PRACTICE-SIZE-VOCAB-V1 BEGIN >>>
// EVERY BYTE BETWEEN THESE TWO SENTINELS IS IDENTICAL IN Crindo2/getpracticehelp AND
// Crindo2/gph-mcp-server. An edit here MUST land in both repos in the same change;
// tests/practice-size-vocab.test.mjs in EACH repo pins this block's SHA-256 to
// tests/fixtures/practice-size-vocab.lock.json.
//
// WHY THIS EXISTS (C77-c). `providers.practice_size_fit` (legacy, TEXT DEFAULT 'All', 100%
// populated, no source, no history) and `providers.enriched_practice_size_fit` (written only
// by the grounded extractor) did not share a closed set: six tokens against five, three
// overlapping. Until one vocabulary existed, search.js equality filtering was silently
// wrong (a filter on the legacy column could not see an enriched value), MCP advertised an
// enum that meant two things, and no repair to either column was verifiable. This module is
// the single source of truth: the closed set, the projection of every observed stored token
// onto it, the request-side normalisation, the display label, and the SQL fragment that
// filters on the RESOLVED (enriched-first) value. It performs NO data write, NO bulk rewrite
// and NO column migration (C76-c). C1-RECLASSIFY writes into this vocabulary; it is not here.
//
// OBSERVED STORED TOKENS, D1 7a06fa73-938d-4ad7-8855-87f6806692ca, read 2026-09-12 with
// SELECT ... GROUP BY (counts only, no row text). Whole table, 76,977 rows:
//   practice_size_fit           Solo/Small 42,783 . Mid-size 25,369 . All 6,081 . Large 2,720
//                               . Small 13 . N/A 11 . NULL 0
//   enriched_practice_size_fit  NULL 75,475 . All 1,087 . Small 309 . Large 84 . Medium 14
//                               . Solo 8
// No case, whitespace or empty-string variants exist on either column (GROUP BY is exact).
// The projection below is TOTAL over these eleven tokens: every one maps to one or more
// vocabulary values, or is named in UNMAPPABLE with its count. There is exactly one
// unmappable token, legacy 'N/A' (11 rows; 11 in the entity-gated cohort), and it maps to
// NOTHING rather than to 'All': "not applicable" is the absence of a size assertion, and
// projecting it onto the SQL default would invent a value (the C77-b class of defect).
//
// THE CLOSED SET. Five tokens, the ones the claim-edit form (functions/claim/edit/
// [token].js), the MCP match_practice enum and the extractor already use. 'All' is kept as a
// vocabulary value because BOTH columns hold it and the grounded extractor asserts it on
// 1,087 rows; it means "size does not discriminate". On the LEGACY column it is also the SQL
// DEFAULT, so an unenriched 'All' cannot be told from never-set -- that fact lives in the
// consumers (match.js pays it nothing, C50), not in the projection.
//
// COMPOUND. Legacy 'Solo/Small' (42,783 rows, 55.6% of the table) is a fit spanning two
// atoms. It projects to BOTH ['Solo', 'Small'] rather than being collapsed to either: a
// filter for 'Solo' and a filter for 'Small' both see it, and the display label re-joins the
// two atoms with '/' so the rendered string is unchanged. Collapsing it would be a data
// decision this lane was not given.

export const PRACTICE_SIZE_VOCAB = Object.freeze(['Solo', 'Small', 'Mid-size', 'Large', 'All']);

// Raw stored token -> ordered list of vocabulary values. Keys are the EXACT stored strings.
// An empty list means "observed, unmappable, asserts nothing". A token absent from the map is
// UNOBSERVED; projectStoredSize() returns [] for it too (fail-soft, like every other additive
// column in this schema) and practice-size-vocab.test.mjs asserts the observed set is
// exactly these keys, so a new token appearing in D1 is caught by the next fixture refresh,
// not silently absorbed.
export const LEGACY_PROJECTION = Object.freeze({
  'Solo/Small': Object.freeze(['Solo', 'Small']),
  'Mid-size':   Object.freeze(['Mid-size']),
  'All':        Object.freeze(['All']),
  'Large':      Object.freeze(['Large']),
  'Small':      Object.freeze(['Small']),
  'N/A':        Object.freeze([]),
});

export const ENRICHED_PROJECTION = Object.freeze({
  'All':    Object.freeze(['All']),
  'Small':  Object.freeze(['Small']),
  'Large':  Object.freeze(['Large']),
  'Medium': Object.freeze(['Mid-size']),
  'Solo':   Object.freeze(['Solo']),
});

// Named explicitly, with the count at the read above, so the unmappable set is a fact in the
// code and not a surprise in a query.
export const UNMAPPABLE = Object.freeze({
  legacy:   Object.freeze([{ token: 'N/A', rows: 11, read: '2026-09-12' }]),
  enriched: Object.freeze([]),
});

// Request-side aliases. Callers do not send the stored tokens: match_sessions.practice_size
// (DISTINCT, counts only, read 2026-09-12) carries 'Small' 348, 'small' 178, 'Solo' 52, the
// public wizard's 'Solo (1-2)' 47 / 'Small (3-10)' 38 / 'Mid-size (11-25)' 31 /
// 'Large (25+)' 15, 'Mid-size' 37, 'medium' 10, 'Large' 10, 'Solo/Small' 1, plus free-text
// numerics ('2-5', '16+', '4.0', '3 locations'). The numerics are NOT mapped: turning a head
// count into a size bucket is a classification rule nobody has ruled on, and an unmapped
// request simply earns and filters nothing, exactly as it does today.
const REQUEST_ALIASES = Object.freeze({
  'solo': 'Solo',
  'small': 'Small',
  'medium': 'Mid-size', 'mid-size': 'Mid-size', 'midsize': 'Mid-size', 'mid size': 'Mid-size', 'mid': 'Mid-size',
  'large': 'Large',
  'all': 'All', 'all sizes': 'All',
});

const VOCAB_ORDER = Object.freeze(Object.fromEntries(PRACTICE_SIZE_VOCAB.map((v, i) => [v, i])));

function nonEmpty(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function uniqueInVocabOrder(list) {
  const seen = new Set();
  const out = [];
  for (const v of list) if (VOCAB_ORDER[v] != null && !seen.has(v)) { seen.add(v); out.push(v); }
  return out.sort((a, b) => VOCAB_ORDER[a] - VOCAB_ORDER[b]);
}

/**
 * Project one STORED token onto the vocabulary.
 * @param {unknown} raw     the stored column value, exactly as read
 * @param {'legacy'|'enriched'} column  which column it was read from
 * @returns {string[]}      vocabulary values (possibly several, possibly none)
 */
export function projectStoredSize(raw, column) {
  const s = nonEmpty(raw);
  if (s == null) return [];
  const map = column === 'enriched' ? ENRICHED_PROJECTION : LEGACY_PROJECTION;
  return map[s] ? [...map[s]] : [];
}

/**
 * Project a REQUEST-side value (MCP arg, wizard pill, query string) onto the vocabulary.
 * Case-insensitive; a trailing parenthetical ("Small (3-10)") is dropped; '/' joins atoms.
 * Vocabulary values themselves always round-trip. Unknown text projects to [].
 */
export function projectRequestedSize(input) {
  const s = nonEmpty(input);
  if (s == null) return [];
  const stripped = s.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
  const atoms = stripped.split('/').map(a => a.trim()).filter(Boolean);
  return uniqueInVocabOrder(atoms.map(a => REQUEST_ALIASES[a]).filter(Boolean));
}

/**
 * Resolve a provider row's practice size the way every renderer already resolves enriched
 * fields: the enriched column when it is non-empty, else the legacy column, else nothing.
 * Mirrors resolveEnrichedProfile()'s `enrichedSize || firstNonEmpty(p.practice_size_fit)`.
 * @returns {{ values: string[], source: 'enriched'|'legacy'|'none', raw: string|null }}
 */
export function resolvePracticeSize(row = {}) {
  const enriched = nonEmpty(row.enriched_practice_size_fit);
  if (enriched != null) return { values: projectStoredSize(enriched, 'enriched'), source: 'enriched', raw: enriched };
  const legacy = nonEmpty(row.practice_size_fit);
  if (legacy != null) return { values: projectStoredSize(legacy, 'legacy'), source: 'legacy', raw: legacy };
  return { values: [], source: 'none', raw: null };
}

/**
 * Display label for a list of vocabulary values: atoms joined with '/', in vocabulary order,
 * so legacy 'Solo/Small' renders as 'Solo/Small' and enriched 'Medium' as 'Mid-size'.
 * Returns null when there is nothing to say -- callers omit the line; no literal is invented.
 */
export function practiceSizeLabel(values) {
  const v = uniqueInVocabOrder(Array.isArray(values) ? values : []);
  return v.length ? v.join('/') : null;
}

/**
 * Stored tokens on `column` whose projection includes ANY of `values`.
 */
export function storedTokensFor(values, column) {
  const want = new Set(values);
  const map = column === 'enriched' ? ENRICHED_PROJECTION : LEGACY_PROJECTION;
  return Object.keys(map).filter(k => map[k].some(v => want.has(v)));
}

/**
 * SQL WHERE fragment (D1/SQLite) selecting rows whose RESOLVED practice size (enriched column
 * when non-empty, else legacy) projects onto any of `values`. Same resolution rule as
 * resolvePracticeSize(), expressed in SQL so search.js and the renderers cannot disagree
 * about which rows a vocabulary value names. Empty `values` yields a fragment that matches no
 * row -- a request nobody can project must not widen into the whole directory.
 * @returns {{ sql: string, binds: string[] }}
 */
export function practiceSizeFilterSql(values) {
  const want = uniqueInVocabOrder(Array.isArray(values) ? values : []);
  if (!want.length) return { sql: '0', binds: [] };
  const enrichedTokens = storedTokensFor(want, 'enriched');
  const legacyTokens = storedTokensFor(want, 'legacy');
  const inList = tokens => tokens.length ? `IN (${tokens.map(() => '?').join(', ')})` : null;
  const parts = [];
  const binds = [];
  const eIn = inList(enrichedTokens);
  if (eIn) {
    parts.push(`(NULLIF(TRIM(enriched_practice_size_fit), '') IS NOT NULL AND TRIM(enriched_practice_size_fit) ${eIn})`);
    binds.push(...enrichedTokens);
  }
  const lIn = inList(legacyTokens);
  if (lIn) {
    parts.push(`(NULLIF(TRIM(enriched_practice_size_fit), '') IS NULL AND TRIM(practice_size_fit) ${lIn})`);
    binds.push(...legacyTokens);
  }
  return { sql: parts.length ? `(${parts.join(' OR ')})` : '0', binds };
}
// <<< PRACTICE-SIZE-VOCAB-V1 END <<<
