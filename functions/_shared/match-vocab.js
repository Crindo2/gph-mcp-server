// C596-B1 MATCH VOCABULARY -- the single source for /api/match's buyer-need vocabulary,
// national-coverage evidence and "why this matched" labels (program GPH-MCP-SERVING-01-C596,
// stage C596-B1-MATCH-BUILD; design C596 D1 s.4.3 and s.7, corrected by C598 s.6).
//
// WHAT THIS MODULE IS FOR. /api/match gains two optional, additive request arguments:
// `service_needs` (an array of CLOSED enum codes, never free text) and
// `vendor_geo_preference` (a closed enum). This file holds every code, every synonym used to
// find evidence for a code in a vendor's RESOLVED profile (functions/_shared/enrichment.js
// resolveEnrichedProfile, imported read-only), and every label a caller may render. A later
// stage copies this module byte-identically into Crindo2/gph-mcp-server, so it is pinned by
// SHA-256 in tests/fixtures/match-vocab.lock.json. Edit it only together with that lock.
//
// RULES THIS FILE ENFORCES BY CONSTRUCTION
//   - No free text. A code is valid only if it is in ALL_NEED_CODES (frozen) AND in the
//     vocabulary of the request's resolved category.
//   - Missing = unknown. A need with no covering resolved text yields NO evidence record. There
//     is no penalty and no exclusion here; the caller scores unknown as 0.
//   - Enrichment presence never scores. Evidence exists only where a listed synonym matches
//     resolved text, case-folded, at a word boundary. Nothing reads has_enrichment.
//   - Bare abbreviations. A synonym containing the bare token `np` or `pa` matches ONLY inside
//     resolved services tags, never in a description or a location (`PA` is also Pennsylvania).
//   - Z1. Every string a "why matched" item can carry is a code or label written in this file,
//     or a value that passed through publicConfidence / publicGroundedIn. No tag text,
//     description sentence or location string is ever returned.
//
// FACET SEMANTICS. Codes are grouped into facets. Within a facet the codes are OR (any one
// evidenced code covers the facet); across facets they are AND (coverage is the fraction of
// requested facets covered). Staffing has three facets (role, engagement, setting). Billing
// and credentialing codes are each their own facet, so asking for two scopes asks for both.
//
// DRAFT STATUS. The billing and credentialing synonym lists are DRAFT. They freeze after the
// per-category term-frequency scan (scripts/match-benchmark/vocab_frequency.sql, generated from
// this module) has been run read-only by the verifier. The staffing lists are the design's
// first draft (C596 D1 s.4.3) and are subject to the same scan.
import {
  publicConfidence,
  publicGroundedIn,
  publicLocations,
} from './enrichment.js';

// ---------------------------------------------------------------------------------------------
// Geography preference (closed enum)
// ---------------------------------------------------------------------------------------------
export const VENDOR_GEO_PREFERENCES = Object.freeze([
  'LOCAL_PREFERRED',
  'STATE_PREFERRED',
  'NATIONAL_OK',
  'NATIONAL_ONLY',
]);

// Preferences under which `state` may be omitted.
export const STATE_OPTIONAL_PREFERENCES = Object.freeze(['NATIONAL_OK', 'NATIONAL_ONLY']);

export const MAX_SERVICE_NEEDS = 6;

// ---------------------------------------------------------------------------------------------
// Vocabularies. Each entry: code -> { category, facet, synonyms, draft }.
// `category` is the resolved D1 category (category-alias.js dbCategory) the code belongs to.
// ---------------------------------------------------------------------------------------------
const STAFFING = 'Healthcare Staffing & Recruiting';
const BILLING = 'Medical Billing & RCM';
const CREDENTIALING = 'Credentialing Services';

const NP_SYNONYMS = ['nurse practitioner', 'np recruitment', 'np placement', 'aprn', 'np'];
const PA_SYNONYMS = ['physician assistant', 'physician associate', 'pa recruitment', 'pa placement', 'pa-c', 'pa'];

const VOCAB = {
  // Staffing: role (OR within)
  STAFFING_ROLE_NP: { category: STAFFING, facet: 'staffing_role', draft: false, synonyms: NP_SYNONYMS },
  STAFFING_ROLE_PA: { category: STAFFING, facet: 'staffing_role', draft: false, synonyms: PA_SYNONYMS },
  STAFFING_ROLE_APP: {
    category: STAFFING, facet: 'staffing_role', draft: false,
    // APP is the union of NP and PA evidence plus its own terms.
    synonyms: [...NP_SYNONYMS, ...PA_SYNONYMS, 'advanced practice', 'app recruitment'],
  },
  STAFFING_ROLE_PHYSICIAN: {
    category: STAFFING, facet: 'staffing_role', draft: false,
    synonyms: ['physician recruitment', 'physician placement', 'physician staffing', 'locum tenens physician'],
  },
  STAFFING_ROLE_RN: {
    category: STAFFING, facet: 'staffing_role', draft: false,
    synonyms: ['nurse recruitment', 'nursing recruitment', 'travel nursing', 'travel nurse', 'registered nurse', 'nurse staffing'],
  },
  STAFFING_ROLE_ALLIED: {
    category: STAFFING, facet: 'staffing_role', draft: false,
    synonyms: ['allied health', 'therapy staffing', 'travel therapy'],
  },
  STAFFING_ROLE_CLINICAL_SUPPORT: {
    category: STAFFING, facet: 'staffing_role', draft: false,
    synonyms: ['clinical support', 'medical assistant'],
  },
  // Staffing: engagement (OR within)
  STAFFING_ENG_PERMANENT: {
    category: STAFFING, facet: 'staffing_engagement', draft: false,
    synonyms: ['permanent placement', 'permanent staffing', 'perm placement', 'direct hire', 'direct-hire'],
  },
  STAFFING_ENG_LOCUM: {
    category: STAFFING, facet: 'staffing_engagement', draft: false,
    synonyms: ['locum tenens', 'locums'],
  },
  STAFFING_ENG_TEMPORARY: {
    category: STAFFING, facet: 'staffing_engagement', draft: false,
    synonyms: ['temporary staffing', 'temp staffing', 'contract staffing', 'interim staffing'],
  },
  STAFFING_ENG_TEMP_TO_HIRE: {
    category: STAFFING, facet: 'staffing_engagement', draft: false,
    synonyms: ['temp-to-hire', 'temp to hire', 'contract-to-hire', 'contract to hire'],
  },
  STAFFING_ENG_PRN: {
    category: STAFFING, facet: 'staffing_engagement', draft: false,
    synonyms: ['prn', 'per diem'],
  },
  // Staffing: setting (OR within). Evidenced on almost no rows today: resolves to unknown.
  STAFFING_SET_URGENT_CARE: { category: STAFFING, facet: 'staffing_setting', draft: false, synonyms: ['urgent care'] },
  STAFFING_SET_OUTPATIENT: { category: STAFFING, facet: 'staffing_setting', draft: false, synonyms: ['outpatient', 'ambulatory'] },
  STAFFING_SET_PRIMARY_CARE: { category: STAFFING, facet: 'staffing_setting', draft: false, synonyms: ['primary care', 'family medicine'] },
  STAFFING_SET_EMERGENCY: { category: STAFFING, facet: 'staffing_setting', draft: false, synonyms: ['emergency department', 'emergency medicine'] },
  STAFFING_SET_INPATIENT: { category: STAFFING, facet: 'staffing_setting', draft: false, synonyms: ['inpatient', 'hospital'] },

  // Billing (DRAFT; each code its own facet)
  BILLING_SCOPE_FULL_RCM: {
    category: BILLING, facet: 'BILLING_SCOPE_FULL_RCM', draft: true,
    synonyms: ['revenue cycle management', 'full revenue cycle', 'end-to-end billing', 'full-service billing', 'rcm'],
  },
  BILLING_SCOPE_CLAIMS_SUBMISSION: {
    category: BILLING, facet: 'BILLING_SCOPE_CLAIMS_SUBMISSION', draft: true,
    synonyms: ['claims submission', 'claim submission', 'claims processing', 'electronic claims', 'claims management'],
  },
  BILLING_SCOPE_DENIAL_MANAGEMENT: {
    category: BILLING, facet: 'BILLING_SCOPE_DENIAL_MANAGEMENT', draft: true,
    synonyms: ['denial management', 'denials management', 'claim denials', 'denied claims'],
  },
  BILLING_SCOPE_AR_FOLLOWUP: {
    category: BILLING, facet: 'BILLING_SCOPE_AR_FOLLOWUP', draft: true,
    synonyms: ['accounts receivable', 'a/r follow-up', 'a/r management', 'a/r recovery'],
  },
  BILLING_SCOPE_PATIENT_BILLING: {
    category: BILLING, facet: 'BILLING_SCOPE_PATIENT_BILLING', draft: true,
    synonyms: ['patient billing', 'patient statements', 'patient collections'],
  },
  BILLING_SCOPE_CHARGE_CAPTURE: {
    category: BILLING, facet: 'BILLING_SCOPE_CHARGE_CAPTURE', draft: true,
    synonyms: ['charge capture', 'charge entry'],
  },
  BILLING_SCOPE_ELIGIBILITY_VERIFICATION: {
    category: BILLING, facet: 'BILLING_SCOPE_ELIGIBILITY_VERIFICATION', draft: true,
    synonyms: ['eligibility verification', 'insurance verification', 'benefits verification'],
  },
  BILLING_SCOPE_CODING: {
    category: BILLING, facet: 'BILLING_SCOPE_CODING', draft: true,
    synonyms: ['medical coding', 'coding services', 'cpt coding', 'icd-10 coding', 'coding audit'],
  },

  // Credentialing (DRAFT; each code its own facet)
  CRED_PAYER_ENROLLMENT: {
    category: CREDENTIALING, facet: 'CRED_PAYER_ENROLLMENT', draft: true,
    synonyms: ['payer enrollment', 'insurance enrollment', 'payer contracting', 'insurance credentialing'],
  },
  CRED_INITIAL_CREDENTIALING: {
    category: CREDENTIALING, facet: 'CRED_INITIAL_CREDENTIALING', draft: true,
    synonyms: ['initial credentialing', 'provider credentialing', 'new provider credentialing'],
  },
  CRED_RECREDENTIALING: {
    category: CREDENTIALING, facet: 'CRED_RECREDENTIALING', draft: true,
    synonyms: ['recredentialing', 're-credentialing', 'revalidation'],
  },
  CRED_CAQH: {
    category: CREDENTIALING, facet: 'CRED_CAQH', draft: true,
    synonyms: ['caqh', 'caqh proview'],
  },
  CRED_HOSPITAL_PRIVILEGING: {
    category: CREDENTIALING, facet: 'CRED_HOSPITAL_PRIVILEGING', draft: true,
    synonyms: ['hospital privileging', 'hospital privileges', 'privileging'],
  },
  CRED_STATE_LICENSING: {
    category: CREDENTIALING, facet: 'CRED_STATE_LICENSING', draft: true,
    synonyms: ['state licensing', 'medical licensing', 'license application', 'licensure'],
  },
  CRED_MEDICARE_MEDICAID_ENROLLMENT: {
    category: CREDENTIALING, facet: 'CRED_MEDICARE_MEDICAID_ENROLLMENT', draft: true,
    synonyms: ['medicare enrollment', 'medicaid enrollment', 'pecos'],
  },
  CRED_DELEGATED_CREDENTIALING: {
    category: CREDENTIALING, facet: 'CRED_DELEGATED_CREDENTIALING', draft: true,
    synonyms: ['delegated credentialing', 'credentials verification organization', 'cvo'],
  },
};

// The flat, frozen list of every code (the wire vocabulary). Never retyped elsewhere.
export const ALL_NEED_CODES = Object.freeze(Object.keys(VOCAB));

// Per-category vocabulary, keyed by resolved D1 category.
export const CATEGORY_NEED_CODES = Object.freeze(
  ALL_NEED_CODES.reduce((acc, code) => {
    const cat = VOCAB[code].category;
    (acc[cat] = acc[cat] || []).push(code);
    return acc;
  }, {})
);
for (const cat of Object.keys(CATEGORY_NEED_CODES)) Object.freeze(CATEGORY_NEED_CODES[cat]);

export const NEED_FACET = Object.freeze(
  Object.fromEntries(ALL_NEED_CODES.map(c => [c, VOCAB[c].facet]))
);

// Codes whose synonym lists are DRAFT until the frequency scan freezes them.
export const DRAFT_NEED_CODES = Object.freeze(ALL_NEED_CODES.filter(c => VOCAB[c].draft));

// The synonym table, frozen, for the frequency-scan generator and tests.
export const NEED_SYNONYMS = Object.freeze(
  Object.fromEntries(ALL_NEED_CODES.map(c => [c, Object.freeze([...VOCAB[c].synonyms])]))
);

// ---------------------------------------------------------------------------------------------
// Constant label maps (the only strings a "why matched" renderer may print)
// ---------------------------------------------------------------------------------------------
export const NEED_LABEL = Object.freeze({
  STAFFING_ROLE_NP: 'NP recruitment',
  STAFFING_ROLE_PA: 'PA recruitment',
  STAFFING_ROLE_APP: 'Advanced practice provider recruitment',
  STAFFING_ROLE_PHYSICIAN: 'Physician recruitment',
  STAFFING_ROLE_RN: 'Nurse recruitment',
  STAFFING_ROLE_ALLIED: 'Allied health staffing',
  STAFFING_ROLE_CLINICAL_SUPPORT: 'Clinical support staffing',
  STAFFING_ENG_PERMANENT: 'Permanent placement',
  STAFFING_ENG_LOCUM: 'Locum tenens',
  STAFFING_ENG_TEMPORARY: 'Temporary staffing',
  STAFFING_ENG_TEMP_TO_HIRE: 'Temp-to-hire',
  STAFFING_ENG_PRN: 'PRN / per diem',
  STAFFING_SET_URGENT_CARE: 'Urgent care setting',
  STAFFING_SET_OUTPATIENT: 'Outpatient setting',
  STAFFING_SET_PRIMARY_CARE: 'Primary care setting',
  STAFFING_SET_EMERGENCY: 'Emergency setting',
  STAFFING_SET_INPATIENT: 'Inpatient setting',
  BILLING_SCOPE_FULL_RCM: 'Full revenue cycle management',
  BILLING_SCOPE_CLAIMS_SUBMISSION: 'Claims submission',
  BILLING_SCOPE_DENIAL_MANAGEMENT: 'Denial management',
  BILLING_SCOPE_AR_FOLLOWUP: 'A/R follow-up',
  BILLING_SCOPE_PATIENT_BILLING: 'Patient billing',
  BILLING_SCOPE_CHARGE_CAPTURE: 'Charge capture',
  BILLING_SCOPE_ELIGIBILITY_VERIFICATION: 'Eligibility verification',
  BILLING_SCOPE_CODING: 'Medical coding',
  CRED_PAYER_ENROLLMENT: 'Payer enrollment',
  CRED_INITIAL_CREDENTIALING: 'Initial credentialing',
  CRED_RECREDENTIALING: 'Recredentialing',
  CRED_CAQH: 'CAQH management',
  CRED_HOSPITAL_PRIVILEGING: 'Hospital privileging',
  CRED_STATE_LICENSING: 'State licensing',
  CRED_MEDICARE_MEDICAID_ENROLLMENT: 'Medicare / Medicaid enrollment',
  CRED_DELEGATED_CREDENTIALING: 'Delegated credentialing',
});

export const EVIDENCE_LABEL = Object.freeze({
  services: 'listed services',
  description: 'company description',
});

export const EVIDENCE_SOURCE_LABEL = Object.freeze({
  enriched: 'GPH-researched',
  vendor_edit: 'vendor-supplied',
  legacy: 'GPH directory listing data',
});

export const GEO_BASIS = Object.freeze({
  same_state: 'Located in your state',
  region: 'Located in your region',
  national_listing: 'Serves clients nationally',
  serves_state: 'Lists your state among the locations it serves',
});

// ---------------------------------------------------------------------------------------------
// Evidence weights (C596 D1 s.7). Points come only from a matched, evidenced fact.
// ---------------------------------------------------------------------------------------------
export const CAPABILITY_MAX_POINTS = 40;
export const EVIDENCE_TYPE_WEIGHT = Object.freeze({ services: 1.0, description: 0.6 });
export const ENRICHED_CONFIDENCE_WEIGHT = Object.freeze({ high: 1.0, medium: 0.8, low: 0.5 });
// An enriched value whose confidence is absent or unmapped weighs as low.
export const ENRICHED_UNKNOWN_CONFIDENCE_WEIGHT = 0.5;
export const LEGACY_SOURCE_WEIGHT = 0.5;
// A claimed vendor cannot buy rank by editing tags: vendor-supplied evidence is capped.
export const VENDOR_EDIT_WEIGHT_CAP = 0.7;

// ---------------------------------------------------------------------------------------------
// National-coverage evidence (C598 s.6; brief s.1.2). Frozen phrase list.
// ---------------------------------------------------------------------------------------------
export const NATIONAL_LOCATION_TOKENS = Object.freeze(['national', 'nationwide']);
export const NATIONAL_DESCRIPTION_PHRASES = Object.freeze([
  'nationwide',
  'national coverage',
  'all 50 states',
  'across the united states',
  'across the u.s.',
]);

// ---------------------------------------------------------------------------------------------
// Matching primitives
// ---------------------------------------------------------------------------------------------
const BARE_ABBREVIATION = /(?<![a-z0-9])(np|pa)(?![a-z0-9])/;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

export function foldText(v) {
  if (v === null || v === undefined) return '';
  return String(v).toLowerCase().replace(/\s+/g, ' ').trim();
}

// Word-boundary, case-folded phrase matcher. `plural` admits a trailing "s".
function phraseMatcher(phrase, plural) {
  const body = escapeRe(foldText(phrase)).replace(/ /g, '\\s+');
  return new RegExp(`(?<![a-z0-9])${body}${plural ? 's?' : ''}(?![a-z0-9])`);
}

// True when a synonym contains a bare `np` / `pa` token and may therefore match tags only.
export function isTagOnlySynonym(synonym) {
  return BARE_ABBREVIATION.test(foldText(synonym));
}

const COMPILED = Object.freeze(Object.fromEntries(ALL_NEED_CODES.map(code => [
  code,
  Object.freeze(VOCAB[code].synonyms.map(s => Object.freeze({
    re: phraseMatcher(s, true),
    tagOnly: isTagOnlySynonym(s),
  }))),
])));

const NATIONAL_DESCRIPTION_RE = Object.freeze(NATIONAL_DESCRIPTION_PHRASES.map(p => phraseMatcher(p, false)));

/** Does `text` evidence `code`? `where` is 'services' or 'description'. */
export function synonymHit(code, text, where) {
  const syns = COMPILED[code];
  if (!syns) return false;
  const t = foldText(text);
  if (!t) return false;
  return syns.some(s => (where === 'services' || !s.tagOnly) && s.re.test(t));
}

// ---------------------------------------------------------------------------------------------
// Request parsing (closed enums; constant error strings, never echoing input)
// ---------------------------------------------------------------------------------------------
export const MATCH_ARG_ERRORS = Object.freeze({
  vendor_geo_preference: 'vendor_geo_preference must be one of LOCAL_PREFERRED, STATE_PREFERRED, NATIONAL_OK, NATIONAL_ONLY',
  service_needs_type: 'service_needs must be an array of need codes',
  service_needs_size: `service_needs accepts at most ${MAX_SERVICE_NEEDS} codes`,
  service_needs_unknown: 'service_needs contains an unknown code',
  service_needs_duplicate: 'service_needs contains a duplicate code',
  service_needs_category: 'service_needs contains a code that does not apply to this category',
  state_required: 'State is required unless vendor_geo_preference is NATIONAL_OK or NATIONAL_ONLY',
});

export function parseVendorGeoPreference(raw) {
  if (raw === undefined || raw === null) return { value: null };
  if (typeof raw === 'string') {
    const hit = VENDOR_GEO_PREFERENCES.find(v => v === raw);
    if (hit) return { value: hit };
  }
  return { error: MATCH_ARG_ERRORS.vendor_geo_preference };
}

/**
 * Validate `service_needs` against the closed vocabulary of the resolved category.
 * Returns { codes } (codes are the frozen constants, never the caller's strings) or { error }.
 */
export function parseServiceNeeds(raw, dbCategory) {
  if (raw === undefined || raw === null) return { codes: [] };
  if (!Array.isArray(raw)) return { error: MATCH_ARG_ERRORS.service_needs_type };
  if (raw.length > MAX_SERVICE_NEEDS) return { error: MATCH_ARG_ERRORS.service_needs_size };
  const codes = [];
  for (const v of raw) {
    if (typeof v !== 'string') return { error: MATCH_ARG_ERRORS.service_needs_type };
    const code = ALL_NEED_CODES.find(c => c === v);
    if (!code) return { error: MATCH_ARG_ERRORS.service_needs_unknown };
    if (codes.includes(code)) return { error: MATCH_ARG_ERRORS.service_needs_duplicate };
    codes.push(code);
  }
  const allowed = Object.prototype.hasOwnProperty.call(CATEGORY_NEED_CODES, dbCategory)
    ? CATEGORY_NEED_CODES[dbCategory] : [];
  if (codes.some(c => !allowed.includes(c))) return { error: MATCH_ARG_ERRORS.service_needs_category };
  return { codes };
}

// ---------------------------------------------------------------------------------------------
// Evidence extraction (pure)
// ---------------------------------------------------------------------------------------------
function sourceWeight(source, confidence) {
  if (source === 'enriched') {
    return Object.prototype.hasOwnProperty.call(ENRICHED_CONFIDENCE_WEIGHT, confidence)
      ? ENRICHED_CONFIDENCE_WEIGHT[confidence] : ENRICHED_UNKNOWN_CONFIDENCE_WEIGHT;
  }
  if (source === 'vendor_edit') return VENDOR_EDIT_WEIGHT_CAP;
  if (source === 'legacy') return LEGACY_SOURCE_WEIGHT;
  return 0;
}

/** Weight of one evidence record: evidence-type weight x source/confidence weight. */
export function evidenceWeight(rec) {
  if (!rec || !Object.prototype.hasOwnProperty.call(EVIDENCE_TYPE_WEIGHT, rec.evidence)) return 0;
  return EVIDENCE_TYPE_WEIGHT[rec.evidence] * sourceWeight(rec.source, rec.confidence);
}

const SOURCES = Object.freeze(['enriched', 'vendor_edit', 'legacy']);
const asSource = v => SOURCES.find(s => s === v) || null;

function makeRecord(code, evidence, source, resolved) {
  const src = asSource(source);
  return {
    need: code,
    evidence,
    source: src,
    // Extraction confidence/grounding describe the ENRICHMENT extraction only.
    confidence: src === 'enriched' ? publicConfidence(resolved.confidence) : null,
    grounded_in: src === 'enriched' ? publicGroundedIn(resolved.grounded_in) : null,
  };
}

/**
 * Evidence for each requested need on one resolved profile.
 *
 * @param {object} resolved   resolveEnrichedProfile({...row, approved_edits}) output
 * @param {string[]} needCodes validated codes
 * @returns {Array<{need, evidence: 'services'|'description', source, confidence, grounded_in}>}
 *   one record per EVIDENCED need (the best-weighted evidence); unknown needs are absent.
 */
export function evidenceFor(resolved, needCodes) {
  const r = resolved || {};
  const tags = Array.isArray(r.services_tags) ? r.services_tags : [];
  const out = [];
  for (const code of needCodes || []) {
    if (!COMPILED[code]) continue;
    const candidates = [];
    if (tags.some(tag => synonymHit(code, tag, 'services'))) {
      candidates.push(makeRecord(code, 'services', r.services_tags_source, r));
    }
    if (synonymHit(code, r.description, 'description')) {
      candidates.push(makeRecord(code, 'description', r.description_source, r));
    }
    let best = null;
    for (const c of candidates) {
      if (!c.source) continue;
      if (!best || evidenceWeight(c) > evidenceWeight(best)) best = c;
    }
    if (best) out.push(best);
  }
  return out;
}

/**
 * Capability points for one row: CAPABILITY_MAX_POINTS x coverage x evidence weight, with
 * OR within a facet (best weight of its evidenced codes) and AND across facets.
 * Unknown facets contribute 0. Returns { points, facets_requested, facets_evidenced }.
 */
export function capabilityScore(records, needCodes) {
  const facets = [];
  for (const c of needCodes || []) {
    const f = NEED_FACET[c];
    if (f && !facets.includes(f)) facets.push(f);
  }
  if (!facets.length) return { points: 0, facets_requested: 0, facets_evidenced: 0 };
  let sum = 0;
  let evidenced = 0;
  for (const f of facets) {
    let w = 0;
    for (const rec of records || []) {
      if (NEED_FACET[rec.need] === f) w = Math.max(w, evidenceWeight(rec));
    }
    if (w > 0) evidenced++;
    sum += w;
  }
  const points = Math.round((CAPABILITY_MAX_POINTS * sum / facets.length) * 100) / 100;
  return { points, facets_requested: facets.length, facets_evidenced: evidenced };
}

// ---------------------------------------------------------------------------------------------
// Geography evidence
// ---------------------------------------------------------------------------------------------
export const STATE_NAMES = Object.freeze({
  AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california', CO: 'colorado',
  CT: 'connecticut', DE: 'delaware', DC: 'district of columbia', FL: 'florida', GA: 'georgia',
  HI: 'hawaii', ID: 'idaho', IL: 'illinois', IN: 'indiana', IA: 'iowa', KS: 'kansas',
  KY: 'kentucky', LA: 'louisiana', ME: 'maine', MD: 'maryland', MA: 'massachusetts',
  MI: 'michigan', MN: 'minnesota', MS: 'mississippi', MO: 'missouri', MT: 'montana',
  NE: 'nebraska', NV: 'nevada', NH: 'new hampshire', NJ: 'new jersey', NM: 'new mexico',
  NY: 'new york', NC: 'north carolina', ND: 'north dakota', OH: 'ohio', OK: 'oklahoma',
  OR: 'oregon', PA: 'pennsylvania', RI: 'rhode island', SC: 'south carolina', SD: 'south dakota',
  TN: 'tennessee', TX: 'texas', UT: 'utah', VT: 'vermont', VA: 'virginia', WA: 'washington',
  WV: 'west virginia', WI: 'wisconsin', WY: 'wyoming',
});

/**
 * National-coverage evidence, read through the RESOLVED profile (never raw enriched columns).
 * Returns { national, basis: 'city_slug'|'locations'|'description'|null, source }.
 * `source` is 'listing' for city_slug, 'enriched' for resolved locations, and the resolved
 * description_source ('enriched'|'vendor_edit'|'legacy') for a description phrase.
 */
export function nationalEvidence(row, resolved) {
  const r = resolved || {};
  if (foldText(row && row.city_slug) === 'national') {
    return { national: true, basis: 'city_slug', source: 'listing' };
  }
  const locs = Array.isArray(r.locations) ? r.locations : [];
  if (locs.some(l => NATIONAL_LOCATION_TOKENS.includes(foldText(l)))) {
    return { national: true, basis: 'locations', source: 'enriched' };
  }
  const d = foldText(r.description);
  if (d && NATIONAL_DESCRIPTION_RE.some(re => re.test(d))) {
    return { national: true, basis: 'description', source: asSource(r.description_source) };
  }
  return { national: false, basis: null, source: null };
}

const POSTAL = /^\d{5}(?:-\d{4})?$/;
const TRAILING_POSTAL = /\s+\d{5}(?:-\d{4})?$/;

/**
 * Does a resolved location's state segment equal the practice state? Locations follow the
 * closed publicLocations grammar ("City, ST" and similar); only admitted elements are read.
 */
export function servesState(resolved, state) {
  const st = typeof state === 'string' ? state.trim().toUpperCase() : '';
  if (!Object.prototype.hasOwnProperty.call(STATE_NAMES, st)) return false;
  const locs = Array.isArray(resolved && resolved.locations) ? resolved.locations : [];
  if (!locs.length) return false;
  let admitted;
  try { admitted = JSON.parse(publicLocations(JSON.stringify(locs)) || '[]'); } catch { admitted = []; }
  for (const loc of admitted) {
    const segs = String(loc).split(',').map(s => s.trim()).filter(Boolean);
    while (segs.length && POSTAL.test(segs[segs.length - 1])) segs.pop();
    if (!segs.length) continue;
    const last = segs[segs.length - 1].replace(TRAILING_POSTAL, '').trim();
    if (last.toUpperCase() === st || foldText(last) === STATE_NAMES[st]) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// SQL recall helpers (patterns for bound LIKE parameters; never interpolated into SQL text)
// ---------------------------------------------------------------------------------------------
/**
 * LIKE patterns for the capability recall arm: { tags: [...], text: [...] }. A synonym that IS a
 * bare abbreviation (`np`, `pa`) is left out of recall: a substring LIKE cannot honour a word
 * boundary ('%np%' hits "inpatient"), so it would only flood the arm. Such rows still score on
 * their multi-word tags; recall is the union's job, ranking is the scorer's.
 */
export function recallPatterns(needCodes) {
  const tags = [];
  const text = [];
  for (const code of needCodes || []) {
    for (const s of NEED_SYNONYMS[code] || []) {
      if (/^(np|pa)$/.test(foldText(s))) continue;
      const p = `%${foldText(s)}%`;
      if (!tags.includes(p)) tags.push(p);
      if (!isTagOnlySynonym(s) && !text.includes(p)) text.push(p);
    }
  }
  return { tags, text };
}

export const NATIONAL_DESCRIPTION_PATTERNS = Object.freeze(
  NATIONAL_DESCRIPTION_PHRASES.map(p => `%${p}%`)
);

/** LIKE patterns over enriched_locations naming the practice state ([] without a state). */
export function stateLocationPatterns(state) {
  const st = typeof state === 'string' ? state.trim().toUpperCase() : '';
  if (!Object.prototype.hasOwnProperty.call(STATE_NAMES, st)) return [];
  const ab = st.toLowerCase();
  return [`%, ${ab}%`, `%"${ab}"%`, `%${STATE_NAMES[st]}%`];
}
