// Enriched vendor field resolution -- GPH-VENDOR-ENRICHMENT-01 stage P2-WIRE-ENRICHED-RENDER.
//
// WHY THIS FILE EXISTS. The enrichment run wrote enriched_* onto 5,715 provider rows and
// nothing ever read them. The public provider renderer and MCP get_provider_detail both
// kept rendering the legacy `description` / `services_tags` / `practice_size_fit` columns,
// so the corpus we paid to enrich was invisible on both surfaces. This module is the single
// place that decides "enriched, else legacy", so the two surfaces cannot drift apart again.
//
// P2 REPAIR (GEN59, ALLOC-GPH-P2-REPAIR-G59-001, CHAT blob d136494c Y2). The first build of
// this file keyed the new render gates on the RESOLVED value rather than on has_enrichment.
// Every legacy fallback therefore reached the whole corpus. Measured with the verifier's own
// method -- renderProviderPage imported directly from each tree, the identical live
// production row fed to both, related=[]/reviews=[] on both sides -- 74,984 of 74,984
// SERVABLE rows changed render, not the 5,715 the accepted evidence describes. The gates now
// live on has_enrichment, in this resolver AND again in the template, and an unenriched row
// is byte-identical to pre-P2 by construction.
//
// The resolver itself is the sentinel-delimited block below. It is byte-identical to the
// copy in Crindo2/gph-mcp-server functions/mcp.js and is pinned by hash in both repos.

// >>> ENRICHMENT-RESOLVER-V2 BEGIN >>>
// EVERY BYTE BETWEEN THESE TWO SENTINELS IS IDENTICAL IN Crindo2/getpracticehelp
// (functions/_shared/enrichment.js) AND Crindo2/gph-mcp-server (functions/mcp.js). The two
// repos do not share a module, the copies were already textually divergent on 2 of 4
// functions on day one, and nothing compared them. An edit here MUST land in both repos in
// the same change; tests/enrichment-resolver-differential.test.mjs in EACH repo pins this
// block's SHA-256 to tests/fixtures/enrichment-resolver.lock.json and replays a shared
// production-row fixture through it, so either side drifting fails its own PR gate.

// Z1 (GEN59, CHAT blob 053f2e83) -- THE PUBLIC SOURCE CLAUSE IS A CLOSED VOCABULARY.
// `extraction_grounded_in` is the ONLY column the public grounding label may consult, and it
// is consulted as a KEY, never as text. A value absent from this map renders NO source clause
// at all -- not passed through, not truncated, not sanitised. That is why this is a Map with
// an explicit lookup and not an object literal with `||` fallthrough: an object literal
// answers for keys nobody wrote (`constructor`, `toString`), and the `||` fallthrough is
// precisely the branch that turned a stored string into public copy.
//
// WHAT REACHES IT TODAY -- corpus-wide over the 6,050-row servable enriched cohort, read from
// D1 7a06fa73 on 2026-09-09, not sampled: 'both' 2,681, 'site' 2,045, 'serper' 1,026, 'none'
// 120, plus 178 rows each holding a UNIQUE whole extraction-rationale SENTENCE (5,872 + 178
// = 6,050). Only the first two are source names, so only those two render a clause. `serper`
// is a scraping vendor and is not named to a public reader (Z1.3); `none` says nothing
// (Z1.3); a rationale sentence is internal reasoning, not a citation (Z1.2).
const GROUNDED_IN_LABELS = new Map([
  ['site', 'vendor website'],
  ['both', 'vendor website and listing data'],
  ['listing', 'listing data'],
  ['directory', 'listing data'],
]);

// The same closure on the confidence clause. `extraction_confidence` is a stored column that
// renders verbatim into public copy -- the identical shape of defect Z1 names for
// `provenance`. It holds only high/medium/low today (3,051 / 2,175 / 824 over the cohort);
// this map keeps that true whatever a later writer puts in the column.
const CONFIDENCE_LABELS = new Map([
  ['high', 'high'],
  ['medium', 'medium'],
  ['low', 'low'],
]);

// enriched_services_tags / _certifications / _locations are stored as JSON array TEXT.
// '[]' and '""' are the empty encodings that show up in the live table -- both must read
// as absent, not as an empty-but-present section header.
function parseJsonList(raw) {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) return raw.map(v => String(v).trim()).filter(Boolean);
  const s = String(raw).trim();
  if (!s || s === '[]' || s === '""' || s === 'null') return [];
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map(v => String(v).trim()).filter(Boolean);
    } catch {
      // fall through to delimiter split -- a malformed array is still better read as text
    }
  }
  return s.split(',').map(t => t.trim()).filter(Boolean);
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s && s !== 'null') return v;
  }
  return null;
}

// The verbatim pre-P2 legacy split -- `(provider.services_tags || '').split(',')...` as it
// stood in template.js and in MCP get_provider_detail before this stage. Deliberately NOT
// parseJsonList: an unenriched row must produce the pre-P2 tag list byte-for-byte, and
// parseJsonList differs on the '[]' / '""' / 'null' encodings.
function legacyServicesTags(raw) {
  return String(raw === null || raw === undefined ? '' : raw)
    .split(',').map(t => t.trim()).filter(Boolean);
}

/**
 * Resolve the display-facing vendor fields.
 *
 * Y2.1 -- IN THIS RELEASE AN UNENRICHED ROW RENDERS BYTE-IDENTICALLY TO PRE-P2. The first
 * build gated the new sections on the RESOLVED value rather than on has_enrichment, so the
 * legacy fallbacks reached the whole corpus: measured local-vs-local over every servable
 * production row, 74,984 of 74,984 rows changed render, not the 5,715 the accepted evidence
 * describes. The `if (!hasEnrichment)` branch below returns the verbatim pre-P2 expressions
 * -- including a null `description`, because pre-P2 rendered `provider.description` and not
 * `''` -- so no new section and no new JSON-LD key can fire on a legacy row by construction.
 *
 * Y2.2 -- APOLLO-SOURCED FIELDS ARE NOT SHIPPED IN THIS RELEASE. `apollo_founded_year` never
 * reaches a rendered surface: not on an unenriched row (which is what Y2.2 names), and not
 * as the sole source on an enriched row either, because the only grounding disclosure this
 * release renders describes the ENRICHMENT extraction -- an Apollo year underneath it would
 * be attributed to an extraction that never produced it. It is carried out as
 * `apollo_founding_year` for the disagreement rule and for tests, and is never rendered.
 * Whether to surface Apollo with its own provenance disclosure is a separate later decision
 * with its own evidence.
 *
 * Y2.3 -- DISAGREEMENT RULE. Where a row has BOTH enriched_founding_year and
 * apollo_founded_year and they disagree, the ENRICHED value renders with its grounding and
 * the Apollo value does not. `founding_year_disagrees` reports it; 224 servable rows are in
 * that state today (healthware: enriched 1996 vs Apollo 1998).
 *
 * Z1 -- `provenance` IS NOT A DISPLAY FIELD AND NO LONGER LEAVES THIS FUNCTION (GEN59, CHAT
 * blob 053f2e83). It is an internal operational column. Two rows of the enriched cohort hold
 * internal prose in it today -- id 3724 a merge record, id 83589 an audit paragraph carrying
 * a third party's personal email address and phone number -- and eight further rows outside
 * the cohort hold the same kind of note, shielded only by the `!hasEnrichment` early return
 * below. The earlier build PREFERRED this column for the public source clause, so both would
 * have published verbatim to the provider page and through MCP. The fix is not an allowlist
 * of values: the column is not public, so the display resolver does not carry it out at all.
 * The column is UNCHANGED IN THE STORE -- this is a render rule, not a data change. The
 * amendment it supersedes (blob 083b18fe, Q1: "a null provenance must never withhold enriched
 * content") is satisfied a fortiori -- provenance now withholds nothing, because nothing
 * reads it.
 *
 * SCOPE FENCE (blob 63fb4960, V1.2). Nothing here participates in sitemap admission,
 * meta-robots, or any indexing decision. It resolves display fields only.
 */
function resolveEnrichedProfile(p = {}) {
  const enrichedDesc = firstNonEmpty(p.enriched_description);
  const enrichedTags = parseJsonList(p.enriched_services_tags);
  const enrichedSize = firstNonEmpty(p.enriched_practice_size_fit);
  const enrichedYear = firstNonEmpty(p.enriched_founding_year);
  const certifications = parseJsonList(p.enriched_certifications);
  const locations = parseJsonList(p.enriched_locations);
  const apolloYear = firstNonEmpty(p.apollo_founded_year);
  const legacyTags = legacyServicesTags(p.services_tags);

  // VENDOR-PRO-CODE-01 C1 (GEN100, ALLOC-VP-C1-G100-29, C417-C s.3) -- THE LATEST APPROVED
  // provider_edits VALUE OUTRANKS BOTH enriched_* AND LEGACY, for the three fields the
  // moderated claim/edit flow covers (functions/api/claim/edit.js EDITABLE_FIELDS intersected
  // with what this resolver renders: description, services_tags, practice_size_fit).
  // DEFECT THIS CLOSES: approval (functions/api/admin.js action=edit_update) writes an
  // approved edit straight into the LEGACY columns, and this resolver already preferred
  // enriched_* over legacy -- so on any row that also carries enrichment, an approved vendor
  // edit landed in a column this function never returns. A paying member could get his edit
  // approved and still never see it live.
  // NOT A NEW SCHEMA: the caller merges the latest-approved values onto `p.approved_edits` (a
  // plain object keyed by the SAME three field names, built from provider_edits rows already
  // in the store) before calling in -- nothing here queries a table or adds a column. A row
  // with no approved edit (p.approved_edits absent, or present but empty) resolves exactly as
  // before this stage: the branch below degrades to the prior enriched-then-legacy behaviour
  // byte-for-byte, which is what keeps the existing differential fixture (12 real rows, none
  // of them carrying approved_edits) unchanged.
  const approvedEdits = (p && typeof p.approved_edits === 'object' && p.approved_edits) || {};
  const approvedDesc = firstNonEmpty(approvedEdits.description);
  const approvedTags = (approvedEdits.services_tags !== undefined && approvedEdits.services_tags !== null)
    ? legacyServicesTags(approvedEdits.services_tags)
    : [];
  const approvedSize = firstNonEmpty(approvedEdits.practice_size_fit);

  const hasEnrichment = Boolean(
    enrichedDesc || enrichedTags.length || certifications.length ||
    locations.length || enrichedSize || enrichedYear
  );
  const hasApprovedEdit = Boolean(approvedDesc || approvedTags.length || approvedSize);

  if (!hasEnrichment && !hasApprovedEdit) {
    return {
      description: p.description,
      description_source: 'legacy',
      services_tags: legacyTags,
      services_tags_source: 'legacy',
      certifications: [],
      locations: [],
      practice_size_fit: p.practice_size_fit,
      practice_size_fit_source: 'legacy',
      founding_year: null,
      founding_year_source: 'none',
      apollo_founding_year: apolloYear,
      founding_year_disagrees: false,
      confidence: null,
      grounded_in: null,
      has_enrichment: false,
    };
  }

  return {
    description: approvedDesc || enrichedDesc || firstNonEmpty(p.description) || '',
    description_source: approvedDesc ? 'vendor_edit' : (enrichedDesc ? 'enriched' : 'legacy'),
    services_tags: approvedTags.length ? approvedTags : (enrichedTags.length ? enrichedTags : legacyTags),
    services_tags_source: approvedTags.length ? 'vendor_edit' : (enrichedTags.length ? 'enriched' : 'legacy'),
    certifications,
    locations,
    practice_size_fit: approvedSize || enrichedSize || firstNonEmpty(p.practice_size_fit) || null,
    practice_size_fit_source: approvedSize ? 'vendor_edit' : (enrichedSize ? 'enriched' : 'legacy'),
    founding_year: enrichedYear,
    founding_year_source: enrichedYear ? 'enriched' : 'none',
    apollo_founding_year: apolloYear,
    founding_year_disagrees: Boolean(
      enrichedYear && apolloYear &&
      String(enrichedYear).trim() !== String(apolloYear).trim()
    ),
    confidence: firstNonEmpty(p.extraction_confidence),
    grounded_in: firstNonEmpty(p.extraction_grounded_in),
    has_enrichment: hasEnrichment,
  };
}

/**
 * Human label for the grounding line. Empty string when there is nothing to say.
 *
 * Z1 -- EVERY BYTE THIS FUNCTION CAN EMIT IS WRITTEN IN THIS FILE. It reads two stored
 * columns and uses BOTH only as map keys, so the set of strings it can return is finite and
 * enumerable from source, and contains no stored text: the twelve combinations of
 * {high, medium, low} x {vendor website, vendor website and listing data, listing data},
 * those three confidence clauses alone, those three source clauses alone, and ''. There is no
 * path by which a value out of the database becomes public copy. That is the property the
 * corpus scan asserts, and it is the property an allowlist of stored VALUES would not give:
 * an allowlist makes the public surface depend on what a column happens to contain, and this
 * does not depend on the column's contents at all.
 */
function enrichmentGroundingLabel(e) {
  const key = v => (v === null || v === undefined ? '' : String(v).trim().toLowerCase());
  const parts = [];
  const conf = CONFIDENCE_LABELS.get(key(e.confidence));
  if (conf) parts.push(`${conf} confidence`);
  const src = GROUNDED_IN_LABELS.get(key(e.grounded_in));
  if (src) parts.push(`sourced from ${src}`);
  return parts.join(', ');
}
// <<< ENRICHMENT-RESOLVER-V2 END <<<

// AG5.2 (GEN60, ALLOC-GPH-P3B-FIXES-G60-001) -- THE UNAUTHENTICATED JSON API PROJECTS THROUGH
// THE SAME CLOSED MAP THE RENDERER KEYS ON.
//
// Z1 closed the RENDER path and did not close the PROJECTION. functions/api/provider/[slug].js
// SELECTs `extraction_grounded_in` into its public column list and returned it RAW -- byte-
// identical to the store -- on an endpoint that is unauthenticated, has no rate limiting, and
// whose slugs are fully enumerable from /sitemaps/providers-{0,1,2}.xml.
//
// P3C CORPUS FIGURE (GEN60, ALLOC-GPH-P3C-ALLOWLIST-G60-001) -- THIS SUPERSEDES EVERY DOC
// CARRYING 1,324. The exposure is 1,589 rows over the 74,993 the endpoint ADMITS, not 1,324
// over 6,050. P3 measured the ENRICHED COHORT; the endpoint serves the CORPUS, so the cohort
// denominator was the wrong one and understated the row count by 265. Re-read at the admission
// denominator (D1 7a06fa73, 2026-09-10, GROUP BY over all 74,993 admitted rows, not sampled):
// 6,316 admitted rows carry a non-null value and 1,589 of them are OUTSIDE the closed
// vocabulary -- 1,029 `serper` (a scraping vendor, never named to a public reader, Z1.3), 382
// `none` (says nothing, Z1.3), and 178 rows each holding a whole extraction-rationale SENTENCE
// (internal reasoning, not a citation, Z1.2). The page said nothing for those rows; the JSON
// API handed them over.
//
// The cohort-denominator sentence INSIDE the ENRICHMENT-RESOLVER-V2 sentinel above is NOT
// corrected here: that block is byte-pinned by SHA-256 across two repos and a comment edit
// moves the hash. Carried as named residue, not fixed silently.
//
// THIS FUNCTION IS THE PROJECTION'S ONLY ROUTE TO THAT VALUE, and it consults
// GROUNDED_IN_LABELS -- the SAME Map `enrichmentGroundingLabel` keys on, closed over from
// module scope. It is deliberately NOT a second mapping: two mappings drift, and that drift is
// precisely the defect class this closes. It is equally deliberately placed OUTSIDE the
// ENRICHMENT-RESOLVER-V2 sentinel above -- that block is byte-pinned by SHA-256 across this
// repo AND Crindo2/gph-mcp-server, this is a getpracticehelp-side projection concern with no
// counterpart in the MCP copy, and the pinned hash must not move for a change the other repo
// does not need. Adding to the map still requires both repos, as before; that is unchanged.
//
// WHAT IT CAN RETURN, BY CONSTRUCTION AND NOT BY SAMPLING: the set is exactly
// `GROUNDED_IN_LABELS.keys()` union {null}. It returns `k` only on the branch where the Map
// has just been proven to contain `k` as a key, and returns `null` on every other input --
// there is no path by which the caller's string reaches the return value. The normalisation
// (trim + lowercase) is the same normalisation `enrichmentGroundingLabel` applies, so the
// public page and the public API agree on which stored values map and which say nothing.
function publicGroundedIn(raw) {
  if (raw === null || raw === undefined) return null;
  const k = String(raw).trim().toLowerCase();
  return GROUNDED_IN_LABELS.has(k) ? k : null;
}

// The closed vocabulary itself, for corpus scans and tests that must assert a served distinct
// set is a SUBSET of it. Derived from the Map -- never retyped.
const PUBLIC_GROUNDED_IN_VOCABULARY = Object.freeze([...GROUNDED_IN_LABELS.keys()]);

// P3C CLASS 2 (GEN60, ALLOC-GPH-P3C-ALLOWLIST-G60-001) -- `extraction_confidence` IS THE SAME
// DEFECT SHAPE AND GETS THE SAME ONE-LINE FIX.
//
// AG5.2 closed `extraction_grounded_in` and said, in as many words, that `extraction_confidence`
// was projected raw on the adjacent line and was NOT touched because P3 had not measured it.
// Leaving it named rather than fixing it silently was right for that lane. It is not the right
// end state -- leaving a class for a later pass is how AB1 happened twice -- and it is
// authorised and named here.
//
// The fix is the SAME construction against the EXISTING `CONFIDENCE_LABELS` Map, the one
// `enrichmentGroundingLabel` already keys the public confidence clause on. Deliberately NOT a
// second mapping and deliberately NOT a new Map: two mappings drift, and that drift is the
// defect class. Same trim+lowercase normalisation, so page and API agree on what maps.
//
// HONEST MEASUREMENT -- THIS IS NOT A LIVE LEAK TODAY. Read at the admission denominator
// (D1 7a06fa73, 2026-09-10, GROUP BY over all 74,993 admitted rows, not sampled): 6,316 rows
// carry a non-null value, the COMPLETE distinct set is {high 3,052, medium 2,175, low 1,089},
// and ZERO rows are outside the closed vocabulary. So this closes a defect CLASS, not an
// observed disclosure. Claiming a leak here would be an overclaim. Not closing it would leave
// the endpoint's guarantee resting on what the column happens to contain -- precisely the
// dependency Z1 refused to accept for `provenance`.
function publicConfidence(raw) {
  if (raw === null || raw === undefined) return null;
  const k = String(raw).trim().toLowerCase();
  return CONFIDENCE_LABELS.has(k) ? k : null;
}

// Derived from the Map -- never retyped. Same reason as PUBLIC_GROUNDED_IN_VOCABULARY.
const PUBLIC_CONFIDENCE_VOCABULARY = Object.freeze([...CONFIDENCE_LABELS.keys()]);

// P3C CLASS 3 (GEN60, ALLOC-GPH-P3C-ALLOWLIST-G60-001) -- `enriched_locations` IS NOT A LEAK,
// AND IS NOT LEFT UNRULED EITHER.
//
// THE RULING. The surface serves business `address` / `city` / `state` by design, so a business
// street address in this column is designed-public and its presence is not the defect. What IS
// the defect is that the column was projected RAW -- the store's own bytes, whatever they are,
// on an unauthenticated and slug-enumerable endpoint -- so its public guarantee was INHERITED
// from the neighbouring address columns rather than stated about itself. DESIGNED-PUBLIC MEANS
// ENUMERATED, NEVER INHERITED FROM A NEIGHBOURING COLUMN. This function is that enumeration.
//
// WHAT THE COLUMN ACTUALLY HOLDS, read at the admission denominator (D1 7a06fa73, 2026-09-10,
// json_each over all 74,993 admitted rows, not sampled). 5,792 rows are non-empty. Every one of
// them is a FLAT JSON ARRAY OF STRINGS: 0 rows contain a brace, 0 contain a nested bracket. The
// column therefore has NO PER-ELEMENT FIELDS to allowlist -- a field allowlist has no referent
// here, and asserting one would be a claim about a shape the store does not have. The 9,884
// elements are short location designations: max element length 56 characters, 8,205 carry a
// comma ("City, ST"), 26 begin with a digit (street-address shape), 40 contain any digit at
// all, and 0 contain an at-sign. No email shape, no URL shape, no prose.
//
// SO THE ENUMERATION IS A GRAMMAR, NOT A VALUE VOCABULARY. A value vocabulary is impossible and
// would be dishonest to claim: the distinct element set is 3,323 place names and grows with the
// corpus. What IS closed, by construction, is the SHAPE -- an element is served only if it is a
// short single-line location designation over an allowed character set at no more than the
// address/city/state/postal comma depth. Everything else the column carries is DROPPED, not
// truncated and not sanitised, exactly as an unmapped grounding value serves null rather than
// text. The served set is a subset of {strings matching this grammar} for ANY store contents
// whatsoever, including contents a later writer puts there.
//
// It reuses `parseJsonList`, the SAME parser the renderer resolves this column with. There is
// deliberately no second parser here, for the same reason there is no second mapping above.
//
// WHAT THE RULE ACTUALLY DROPS ON TODAY'S CORPUS: NOTHING. Run over the complete distinct set
// through the shipped endpoint (3,307 distinct stored values covering all 74,993 admitted rows),
// 9,884 of 9,884 elements are served and 0 are dropped, with 0 outside the grammar. That is the
// honest report and it is the point: this is a defect-class closure, not a live remediation. The
// first build of the grammar was ASCII-only and dropped 29 real accented place names -- the scan
// found that before a deploy did, which is why the scan runs at the corpus denominator and not
// on a sample.
//
// SHAPE OF THE RETURN. `null` in stays `null` out, so the 68,750 admitted rows with no value
// are byte-identical to today. A non-null value returns a JSON array TEXT -- the same type this
// column has always served and the same type the adjacent `enriched_services_tags` and
// `enriched_certifications` serve, so this is a content rule and not a type change. Two
// cosmetic consequences, named here rather than discovered later: the store writes a space
// after each element separator (1,605 multi-element rows) and JSON.stringify does not; and the
// empty encodings the store uses all normalise to the empty array.
const LOCATION_MAX_LENGTH = 64;          // observed max element is 56 -- headroom, not prose room
const LOCATION_MAX_COMMAS = 3;           // address, city, state, postal -- the enumerated depth
// UNICODE LETTERS ARE IN THE GRAMMAR, AND THAT IS A CORRECTION MADE BY THE SCAN, NOT A
// PREFERENCE. The first build of this grammar was ASCII-only. Run at the corpus denominator it
// dropped 29 elements on 29 rows, and every one of them was a legitimate accented place name --
// the scan's whole purpose is to find that before a deploy does. \p{L} and \p{M} admit the
// letters and combining marks of any script; \p{N} the digits. Nothing else widens: no
// at-sign, no angle bracket, no control character, no newline, no colon, no quote. The closure
// property is unchanged -- what is served is still a set this line defines and the store cannot
// add to. Mojibake (a byte sequence that decodes to punctuation rather than letters) still
// fails, which is the correct outcome for a value that is not a name.
const LOCATION_GRAMMAR = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} .,'\/#&()+-]*$/u;

function publicLocations(raw) {
  if (raw === null || raw === undefined) return null;
  const admitted = [];
  for (const v of parseJsonList(raw)) {
    const s = String(v).trim();
    if (!s || s.length > LOCATION_MAX_LENGTH) continue;
    if (!LOCATION_GRAMMAR.test(s)) continue;
    if ((s.match(/,/g) || []).length > LOCATION_MAX_COMMAS) continue;
    admitted.push(s);
  }
  return JSON.stringify(admitted);
}

// Exported so a corpus scan and the test suite assert the served grammar rather than restate
// it. Never retyped on the calling side.
const PUBLIC_LOCATION_GRAMMAR = Object.freeze({
  max_length: LOCATION_MAX_LENGTH,
  max_commas: LOCATION_MAX_COMMAS,
  pattern: LOCATION_GRAMMAR.source,
  // The FLAGS ship with the pattern. Without the u flag the pattern is a DIFFERENT regex --
  // the Unicode property escapes stop being property escapes -- so a caller that rebuilt it
  // from the source alone would be asserting against a rule this module does not apply.
  flags: LOCATION_GRAMMAR.flags,
});

export {
  resolveEnrichedProfile,
  publicGroundedIn,
  PUBLIC_GROUNDED_IN_VOCABULARY,
  publicConfidence,
  PUBLIC_CONFIDENCE_VOCABULARY,
  publicLocations,
  PUBLIC_LOCATION_GRAMMAR,
  enrichmentGroundingLabel,
  parseJsonList,
  legacyServicesTags,
};
