/**
 * GPH Intelligence MCP Server
 * Streamable HTTP transport — full MCP protocol over POST /mcp
 * Proxies to live GPH API at getpracticehelp.com
 */

const API_BASE = 'https://www.getpracticehelp.com/api';
const AT_BASE = 'appvHqDMSu6aCwNxA';
const AT_LOG_TABLE = 'tbl5ae8t1PbK2AMkx';

const SERVER_INFO = {
  protocolVersion: '2024-11-05',
  serverInfo: { name: 'gph-intelligence', version: '1.1.1' },
  capabilities: { tools: {}, prompts: {}, resources: {} },
};

// The 25 real `providers.category` values, for enumeration inside the tool descriptions
// (GPH-MCP-SCHEMA-FIX-01 S2, 2026-08-02). AUTHORITATIVE SOURCE IS `list_categories`, which
// reads them live from D1 via /api/categories -- which in turn imports getpracticehelp's
// `CANON` single-writer. This array is a display mirror, unavoidable because tools/list must
// answer synchronously from a static schema and cannot await a remote fetch; if the two ever
// disagree, list_categories wins and this array is the thing to fix.
//
// Deliberately prose, NOT a JSON-Schema `enum`: the server accepts a wide alias space on
// purpose ('billing', 'medical-billing', 'EHR', 'Revenue Cycle Management' all resolve via
// functions/_shared/category-alias.js), and a strict enum would make a conforming client
// refuse those forms outright -- narrowing the surface instead of widening it.
const GPH_CATEGORIES = [
  'Medical Billing & RCM', 'Credentialing Services', 'Healthcare IT & EHR',
  'Practice Management Consulting', 'Healthcare Legal Services', 'Healthcare CPA & Tax Advisory',
  'Medical Coding Services', 'Healthcare Staffing & Recruiting',
  'Healthcare Marketing & Reputation Management', 'Compliance & HIPAA Services',
  'Medical Equipment & Supplies', 'Healthcare Real Estate & Site Selection',
  'Practice Financing & Loans', 'Healthcare Construction & Facilities',
  'Healthcare Signage & Wayfinding', 'Medical Waste & Environmental Services',
  'Healthcare Insurance & Malpractice Brokers', 'Practice Valuation & Brokerage',
  'Patient Financing & Payment Solutions', 'Medical Transcription & Documentation',
  'Pharmacy & Medication Management', 'Telehealth & Virtual Care Infrastructure',
  'Laboratory & Diagnostics Services', 'Group Purchasing Organizations (GPOs)',
  'Healthcare PR & Communications',
];
const CATEGORY_LIST_TEXT = GPH_CATEGORIES.map(c => `'${c}'`).join(', ');

const TOOLS = [
  {
    name: 'match_practice',
    title: 'Recommend Healthcare Vendors for a Practice',
    description: `Recommend and rank the best healthcare vendors for a specific medical practice. Use this when a practice manager, physician, or administrator asks for a recommendation, e.g. "recommend a medical billing / RCM company for my practice", "who should I use for credentialing / payer enrollment", "find an EHR for my small [specialty] practice", or "which practice-management software fits a [size] practice in [city, state]". Scores and ranks providers against the practice profile (specialty, size, location, EHR system, budget) and returns up to 5 merit-ranked matches (quality-scored, no paid placement) with {company_name, category, city, state_abbr, quality_score (0-100), final_score (0-100), verified status, description, website, profile_url, slug}. For open-ended browsing without a practice profile, use search_providers. Pass a match's slug to get_provider_detail for the full profile.`,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        // S1(b): 'Practice Management Software' REMOVED from this list. It was never one of the
        // 25 real categories, so every caller who took the example at face value got zero rows
        // (25 calls, 100% zero-result, 2 of them organic). It now routes to Practice Management
        // Consulting via the alias layer, but it must not be advertised as a category name.
        category: { type: 'string', description: `Service category needed. One of the 25 categories: ${CATEGORY_LIST_TEXT}. Common aliases also resolve (e.g. 'billing', 'RCM', 'EHR', 'credentialing'). Call list_categories for the live list with provider counts.` },
        specialty: { type: 'string', description: "Medical specialty of the practice (e.g. 'Family Medicine', 'Cardiology', 'Pediatrics', 'Dermatology')" },
        // Param-name reconciliation (S5): each description now names its own parameter, because
        // descriptions that named a DIFFERENT noun than the parameter were measurably answered
        // with that noun -- `size` sent 31 times for practice_size, `state_abbr` 11 times for
        // state, `min_quality_score` for min_rating. Those args were silently dropped.
        practice_size: { type: 'string', description: 'Size of the practice by provider count. The parameter is named `practice_size`, not `size`.', enum: ['Solo', 'Small', 'Mid-size', 'Large'] },
        city: { type: 'string', description: 'City where the practice is located. Send city and state separately, not as a combined `location` string.' },
        state: { type: 'string', description: "Two-letter state abbreviation (e.g. 'TX', 'CA', 'NY'). Send as `state`, not `state_abbr` (`state_abbr` is an output field name only)." },
        ehr_system: { type: 'string', description: "EHR system used by the practice (e.g. 'Epic', 'athenahealth', 'AdvancedMD', 'eClinicalWorks'). Helps score providers with compatible integrations higher." },
        budget_range: { type: 'string', description: 'Approximate monthly budget', enum: ['Under $500', '$500-$2,000', '$2,000-$5,000', '$5,000+', 'Not sure'] },
      },
      required: ['category', 'state'],
    },
    // outputSchema (task #12 rider, 2026-07-03): documents the EXISTING result shape
    // callTool() already returns below -- additive metadata only, no behavior change.
    // See DESIGN-NOTE-task12-category-normalization-2026-07-03.md Section 6.
    outputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'array',
          items: { type: 'object', properties: { type: { const: 'text' }, text: { type: 'string' } }, required: ['type', 'text'] },
        },
        isError: { type: 'boolean', description: 'Present and true only on failure (match request error or no candidates).' },
        count: { type: 'integer', description: 'Total scored candidates before the top-5 slice; absent when isError.' },
        ids: {
          type: 'object',
          properties: { surfaced: { type: 'array', items: { type: 'string' }, description: 'Provider slugs shown, in ranked order.' } },
          description: 'Absent when isError.',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'search_providers',
    title: 'Search the Healthcare Vendor Directory',
    description: `Browse and filter the healthcare vendor directory. Use this for open-ended exploration, e.g. "show me medical billing companies in Texas", "list credentialing services", "what EHR vendors are there for cardiology", or when the user wants to page through options rather than get a scored shortlist. Paginated results filtered by category, location, minimum quality score, curated Tier-1 grade, and practice-size fit; returns a page of providers with {company_name, category, city, state_abbr, quality_score (0-100), verified status, contact info, slug}. For a scored recommendation to a specific practice profile, use match_practice instead. Pass a returned slug to get_provider_detail for the full profile.`,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: `Service category to search. One of the 25 categories: ${CATEGORY_LIST_TEXT}. Common aliases also resolve (e.g. 'billing', 'RCM', 'EHR', 'credentialing'). Call list_categories for the live list with provider counts. This tool does NOT accept a specialty filter -- use match_practice for specialty-aware ranking.` },
        state: { type: 'string', description: "Two-letter state abbreviation (e.g. 'TX'). Send as `state`, not `state_abbr` (`state_abbr` is an output field name only). National providers always included." },
        city: { type: 'string', description: 'City name to filter by (partial match supported)' },
        min_rating: { type: 'number', description: 'Minimum quality score (0-100). Most providers score 50-85. The parameter is named `min_rating`, not `min_quality_score`.', minimum: 0, maximum: 100 },
        tier1_grade: { type: 'string', enum: ['A', 'B'], description: "Filter to the curated Tier-1 provider set by grade: 'A' (top-graded) or 'B' (strong). Tier-1 is a hand-reviewed ~4,400-provider subset; most directory records are not Tier-1, so this narrows results sharply. Omit to search the full directory." },
        practice_size_fit: { type: 'string', enum: ['Solo/Small', 'Mid-size', 'Large', 'All'], description: 'Filter providers by the practice size they best serve.' },
        per_page: { type: 'number', description: 'Results per page (1-25, default 10)', minimum: 1, maximum: 25, default: 10 },
        page: { type: 'number', description: 'Page number for pagination (default 1)', minimum: 1, default: 1 },
      },
      required: ['category'],
    },
    // outputSchema (task #12 rider, 2026-07-03): documents the EXISTING result shape
    // callTool() already returns below -- additive metadata only, no behavior change.
    // See DESIGN-NOTE-task12-category-normalization-2026-07-03.md Section 6.
    outputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'array',
          items: { type: 'object', properties: { type: { const: 'text' }, text: { type: 'string' } }, required: ['type', 'text'] },
        },
        isError: { type: 'boolean', description: 'Present and true only on failure.' },
        count: { type: 'integer', description: 'Total matching providers across all pages; absent when isError.' },
        ids: {
          type: 'object',
          properties: { surfaced: { type: 'array', items: { type: 'string' }, description: 'Provider slugs on this page, in returned order.' } },
          description: 'Absent when isError.',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'get_provider_detail',
    title: 'Get Vendor Profile Detail',
    description: `Get the full profile of one healthcare vendor by slug. Use this after match_practice or search_providers when the user asks to "tell me more about [vendor]", "what services does [vendor] offer", "is [vendor] verified", or wants contact info, services, reviews, or listing tier for a specific provider. Returns company_name, category (plus super_category grouping), description, services_tags (comma-delimited services offered), website, phone, city/state, quality_score (0-100), verified status, listing tier (free/paid), practice_size_fit, and reviews (review_count, average_rating). Slug comes from match_practice or search_providers results; returns an error if the slug is unknown.`,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: "Provider slug identifier (e.g. 'ams-solutions-inc-dallas-tx'). Obtained from match_practice or search_providers response." },
      },
      required: ['slug'],
    },
    // outputSchema (task #12 rider, 2026-07-03): documents the EXISTING result shape
    // callTool() already returns below -- additive metadata only, no behavior change.
    // See DESIGN-NOTE-task12-category-normalization-2026-07-03.md Section 6.
    outputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'array',
          items: { type: 'object', properties: { type: { const: 'text' }, text: { type: 'string' } }, required: ['type', 'text'] },
        },
        isError: { type: 'boolean', description: 'Present and true only when the slug is unknown or the fetch fails.' },
        count: { const: 1, description: 'Always 1 on success; absent when isError.' },
        ids: {
          type: 'object',
          properties: { drilled: { type: 'string', description: 'The slug that was looked up.' } },
          description: 'Absent when isError.',
        },
      },
      required: ['content'],
    },
  },
  {
    // GPH-MCP-SCHEMA-FIX-01 S2 (2026-08-02). The discovery affordance. Before this tool the
    // only way to learn a category name was to already know it: 7 of 25 categories had ever
    // been queried in the server's entire telemetry history, leaving 67% of the directory
    // unreachable in practice. Param-less and read-only, so it is cheap for a model to call
    // first and it carries no demand-specification signal of its own.
    name: 'list_categories',
    title: 'List Healthcare Vendor Categories',
    description: `List every service category in the GPH vendor directory with its live provider count. Call this FIRST when you do not already know which category fits the user's need, when a category search returned nothing, or when the user asks what kinds of vendors are available. Returns all 25 categories with {category, slug, providers}. The category names returned here are the exact values match_practice and search_providers expect (common aliases also resolve). Takes no arguments.`,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false, destructiveHint: false },
    inputSchema: { type: 'object', properties: {}, required: [] },
    outputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'array',
          items: { type: 'object', properties: { type: { const: 'text' }, text: { type: 'string' } }, required: ['type', 'text'] },
        },
        isError: { type: 'boolean', description: 'Present and true only on failure.' },
        count: { type: 'integer', description: 'Number of categories returned; absent when isError.' },
      },
      required: ['content'],
    },
  },
];

const PROMPTS = [
  {
    name: 'find_vendor',
    description: 'Find the best healthcare service vendor for a medical practice',
    arguments: [
      { name: 'need', description: 'What the practice needs help with (e.g. medical billing, credentialing, EHR)', required: true },
      { name: 'location', description: 'City and state of the practice', required: false },
    ],
  },
];

// ── JSON-RPC helpers ──

function jsonrpc(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonrpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// ── Tool execution ──

// ── Argument validation (GPH-MCP-SCHEMA-FIX-01 S3 + S4, 2026-08-02) ──
//
// Before this, `tools/call` forwarded whatever it was handed. Two measured consequences over
// 2026-06-24..2026-08-01: (a) 91 calls omitted a parameter the schema declared REQUIRED and
// were served anyway -- `{"query":"medical billing"}` with no category returned a whole-corpus
// count of 74,991 as if it were an answer; (b) 68 calls carried off-schema parameters that were
// silently dropped, so the filter vanished and the result set widened with no error and no
// zero_result flag -- `{"category":"Medical Billing","state_abbr":"TX"}` returned 7,092 national
// rows to a caller who asked for Texas. Silent widening is worse than an error: the caller
// cannot tell it happened, and neither could we.
//
// Both checks read the tool's OWN declared schema (TOOLS above) -- there is no second list to
// drift. Errors are structured MCP tool errors (isError), not JSON-RPC protocol errors, so a
// model receives them as content it can act on and retry.

// Nearest-valid-name hints. Seeded from the parameter names callers actually sent, per
// mcp_usage_log, rather than guessed: `size` 31, `state_abbr` 11, `specialty`-on-search 8,
// `query` 3, `practice_type` 3, `need` 2, `limit` 2, and singletons.
const ARG_HINTS = {
  size: 'practice_size', practice_type: 'specialty', need: 'category', service_needed: 'category',
  budget: 'budget_range', ehr: 'ehr_system', ehr_name: 'ehr_system', state_abbr: 'state',
  state_code: 'state', location: 'city` and `state', query: 'category', q: 'category',
  search: 'category', limit: 'per_page', per_page_size: 'per_page', page_size: 'per_page',
  min_quality_score: 'min_rating', min_quality: 'min_rating', quality_score: 'min_rating',
  rating: 'min_rating', provider: 'slug', provider_slug: 'slug', name: 'slug', id: 'slug',
  tier: 'tier1_grade', grade: 'tier1_grade', size_fit: 'practice_size_fit',
};

function nearestParam(unknown, valid) {
  const hinted = ARG_HINTS[unknown];
  if (hinted && valid.includes(hinted.split('`')[0])) return hinted;
  const u = unknown.toLowerCase().replace(/[_-]/g, '');
  // Substring containment either way catches the common shortening/lengthening mistakes
  // (`spec` -> specialty, `practice_size_range` -> practice_size) without a distance metric.
  let best = null;
  for (const v of valid) {
    const c = v.toLowerCase().replace(/[_-]/g, '');
    if (c === u || c.includes(u) || u.includes(c)) { if (!best || v.length < best.length) best = v; }
  }
  return best;
}

function toolError(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

// Returns an error result, or null when the args are acceptable.
// Exported for tests/arg-validate.test.mjs -- Cloudflare Pages routes only the onRequest*
// handlers, so additional named exports from a Functions module are inert at runtime.
export function validateArgs(toolName, args) {
  const spec = TOOLS.find(t => t.name === toolName);
  if (!spec) return null; // unknown tool -> callTool's own "Unknown tool" path handles it
  const props = (spec.inputSchema && spec.inputSchema.properties) || {};
  const valid = Object.keys(props);
  const required = (spec.inputSchema && spec.inputSchema.required) || [];
  const a = args || {};

  // S4 first: an unrecognized parameter usually explains a missing required one (a caller who
  // sent `need` instead of `category` is failing both checks for one reason), so naming the
  // typo is more useful than reporting the absence.
  const unknown = Object.keys(a).filter(k => !valid.includes(k));
  if (unknown.length) {
    const parts = unknown.map(k => {
      const near = nearestParam(k, valid);
      if (toolName === 'search_providers' && k === 'specialty') {
        return `\`specialty\` is not a parameter of search_providers -- use match_practice, which ranks by specialty fit`;
      }
      return near ? `\`${k}\` is not a parameter -- did you mean \`${near}\`?` : `\`${k}\` is not a parameter`;
    });
    return toolError(
      `Error: unrecognized argument${unknown.length > 1 ? 's' : ''} for ${toolName}.\n` +
      parts.map(p => `- ${p}`).join('\n') +
      `\n\nValid parameters: ${valid.map(v => `\`${v}\``).join(', ')}.` +
      `\n\nThe call was NOT run. An unrecognized filter is dropped, not applied, so running it would have returned a wider result set than you asked for.`
    );
  }

  // S3: declared-required enforcement.
  const missing = required.filter(k => a[k] == null || String(a[k]).trim() === '');
  if (missing.length) {
    const pointer = missing.includes('category')
      ? `\n\nCall list_categories to see all 25 categories with their provider counts.`
      : '';
    return toolError(
      `Error: ${toolName} requires ${missing.map(m => `\`${m}\``).join(' and ')}, which ${missing.length > 1 ? 'were' : 'was'} not supplied.` +
      `\n\nValid parameters: ${valid.map(v => `\`${v}\``).join(', ')}; required: ${required.map(v => `\`${v}\``).join(', ')}.` +
      pointer +
      `\n\nThe call was NOT run. Without \`${missing[0]}\` the result would describe the whole directory rather than answer the question.`
    );
  }
  return null;
}

// TELEMETRY-COLUMNS-01 Set 3 (2026-08-06): mcpSessionId is threaded in so match_practice
// can forward it to /api/match. It is the id THIS server already derived (see
// deriveSessionId) -- 'm:<16 hex>' or 'd:<16 hex>' -- never the client's raw
// Mcp-Session-Id, which is not forwarded anywhere.
async function callTool(name, args, mcpSessionId) {
  if (name === 'list_categories') {
    const res = await fetch(`${API_BASE}/categories`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) return toolError(`Could not load categories: ${data.error || res.status}`);
    const cats = data.categories || [];
    const text = [
      `${cats.length} service categories, ${data.total_providers?.toLocaleString?.() ?? data.total_providers} providers total:`,
      '',
      ...cats.map(c => `- **${c.category}** -- ${c.providers.toLocaleString()} providers`),
      '',
      'Pass a category name to search_providers or match_practice exactly as written above.',
    ].join('\n');
    return { content: [{ type: 'text', text }], count: cats.length };
  }

  if (name === 'match_practice') {
    const res = await fetch(`${API_BASE}/match`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Set 3: the join key. Before this, /api/match wrote the top-10 SELECTED set to
        // match_sessions in `gph-providers` while this server wrote the top-5 RETURNED set
        // to mcp_usage_log in `gph-mcp-telemetry` -- two databases with no shared key, so
        // the funnel could not be followed for any individual query. Persisted on the far
        // side as match_sessions.mcp_session_id.
        //
        // This forwards THIS SERVER'S already-derived opaque id, not the client's raw
        // Mcp-Session-Id. The raw token never leaves this process; the derived form is
        // already what lands in mcp_usage_log.session_id, so the join is an equality on
        // identical strings and nothing new about the caller crosses the boundary.
        // Omitted entirely when there is no id rather than sent empty.
        ...(mcpSessionId ? { 'X-GPH-MCP-Session-Id': mcpSessionId } : {}),
      },
      body: JSON.stringify(args),
    });
    const data = await res.json();
    if (!data.success) return { content: [{ type: 'text', text: `Match failed: ${data.error || 'Unknown error'}` }], isError: true };

    const matches = (data.matches || []).slice(0, 5);
    const text = matches.length === 0
      ? 'No matching providers found for your criteria. Try broadening your search (e.g. remove city filter or change category).'
      : matches.map((m, i) => [
          `${i + 1}. **${m.company_name}**${m.national_label ? ` _(${m.national_label})_` : m.regional_label ? ` _(${m.regional_label})_` : ''}`,
          `   Category: ${m.category}`,
          `   Location: ${m.city || 'National'}, ${m.state_abbr || 'US'}`,
          `   Quality Score: ${m.quality_score}/100${m.verified ? ' ✓ Verified' : ''}`,
          `   Match Score: ${m.final_score}/100`,
          m.description ? `   ${m.description.substring(0, 150)}...` : '',
          m.website ? `   Website: ${m.website}` : '',
          `   Profile: https://www.getpracticehelp.com/providers/${m.slug}/`,
        ].filter(Boolean).join('\n')).join('\n\n');
    // Honest-N tiered ranking (Stage 2.2/2.6, 2026-07-09 directive): surface geo_honesty_note --
    // an all-national, all-regional, or empty-for-geography result set must say so here too, not
    // just on the web widget, since this text IS the caller-facing surface for MCP clients.
    // Generic passthrough -- the Stage 2.6 regional-only case needs no change here, only in the
    // per-row label line above and in match.js's own geoHonestyNote computation.
    const honestyPrefix = data.geo_honesty_note ? `_${data.geo_honesty_note}_\n\n` : '';

    // Set 3: ids.eligible carries the top-25 candidate pool /api/match now returns as
    // eligible_slugs -- the ELIGIBLE rung, alongside surfaced (RETURNED). Telemetry only:
    // it is NOT rendered into `text` and never reaches the caller. Re-sanitized at the
    // telemetry boundary (sanitizeEligibleSlugs) regardless of what arrives here.
    return { content: [{ type: 'text', text: `${honestyPrefix}Found ${data.total || matches.length} providers. Top ${matches.length} matches:\n\n${text}` }], count: data.total ?? matches.length, ids: { surfaced: matches.map(m => m.slug).filter(Boolean), eligible: data.eligible_slugs } };
  }

  if (name === 'search_providers') {
    const params = new URLSearchParams();
    if (args.category) params.set('category', args.category);
    if (args.state) params.set('state', args.state);
    if (args.city) params.set('city', args.city);
    if (args.min_rating) params.set('min_rating', args.min_rating);
    if (args.tier1_grade) params.set('tier1_grade', args.tier1_grade);
    if (args.practice_size_fit) params.set('practice_size_fit', args.practice_size_fit);
    params.set('per_page', Math.min(args.per_page || 10, ROW_CEILING));
    params.set('page', args.page || 1);

    const res = await fetch(`${API_BASE}/search?${params}`);
    const data = await res.json();
    if (!data.success) return { content: [{ type: 'text', text: `Search failed: ${data.error || 'Unknown error'}` }], isError: true };

    const providers = data.providers || [];
    const text = providers.length === 0
      ? 'No providers found matching your criteria.'
      : providers.map((p, i) => [
          `${i + 1}. **${p.company_name}**, ${p.city || 'National'}, ${p.state_abbr || 'US'}`,
          `   Quality: ${p.quality_score}/100${p.verified ? ' ✓ Verified' : ''}`,
          `   Category: ${p.category}`,
          p.phone ? `   Phone: ${p.phone}` : '',
          p.website ? `   Website: ${p.website}` : '',
        ].filter(Boolean).join('\n')).join('\n\n');

    const totalResults = data.pagination?.total ?? data.total ?? providers.length;
    return { content: [{ type: 'text', text: `${totalResults} total results (page ${args.page || 1}):\n\n${text}` }], count: totalResults, ids: { surfaced: providers.map(p => p.slug).filter(Boolean) } };
  }

  if (name === 'get_provider_detail') {
    if (!args.slug) return { content: [{ type: 'text', text: 'Error: slug is required' }], isError: true };

    const res = await fetch(`${API_BASE}/provider/${encodeURIComponent(args.slug)}`);
    // count: 0 so telemetry records the miss as zero_result (D850: drill misses were invisible).
    if (!res.ok) return { content: [{ type: 'text', text: `Provider not found: ${args.slug}` }], isError: true, count: 0 };

    const data = await res.json();
    if (!data.success || !data.provider) return { content: [{ type: 'text', text: `Provider not found: ${args.slug}` }], isError: true, count: 0 };
    const p = data.provider;
    const tags = (p.services_tags || '').split(',').map(t => t.trim()).filter(Boolean);
    const text = [
      `# ${p.company_name}`,
      `**Category:** ${p.category}`,
      `**Location:** ${p.city || 'National'}, ${p.state_abbr || 'US'}`,
      `**Quality Score:** ${p.quality_score}/100${p.verified ? ' ✓ Verified Listing' : ''}`,
      '',
      p.description ? `## About\n${p.description}` : '',
      tags.length ? `## Services\n${tags.join(', ')}` : '',
      `**Practice Size Fit:** ${p.practice_size_fit || 'All sizes'}`,
      p.phone ? `**Phone:** ${p.phone}` : '',
      p.website ? `**Website:** ${p.website}` : '',
      p.google_rating ? `**Google Rating:** ${p.google_rating}/5 (${p.google_review_count || 0} reviews)` : '',
      '',
      `**Profile:** https://www.getpracticehelp.com/providers/${p.slug}/`,
    ].filter(Boolean).join('\n');

    return { content: [{ type: 'text', text }], count: 1, ids: { drilled: args.slug || '' } };
  }

  return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
}

// ── Prompt execution ──

function getPrompt(name, args) {
  if (name === 'find_vendor') {
    const need = args?.need || 'healthcare services';
    const location = args?.location || '';
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `I'm a medical practice owner looking for help with ${need}${location ? ` in ${location}` : ''}. Please use the match_practice tool to find the best providers for my needs. If you need more information about my practice, ask me about my specialty, practice size, EHR system, and budget.`,
          },
        },
      ],
    };
  }
  return null;
}

// ── Access control (2026-06-10): free distribution. Anonymous tools/call ENABLED; paid tiers
//    retired. Rate cap 100 calls/IP/day (rolling daily). Per-call row ceiling 25. Legacy keys
//    honored but not required. Bulk/unmetered -> /data-licensing/. (Supersedes Apr-2026 key-only posture.) ──

const DAILY_LIMIT = 100;   // free-tier calls per IP per UTC day (rolling daily — no lifetime accumulation)
const ROW_CEILING = 25;    // max rows returned per call; bulk/unmetered access -> data licensing
const LICENSING_URL = 'https://www.getpracticehelp.com/data-licensing/';

// Legacy plan limits retained so any pre-existing keyed caller keeps working. Keys are NOT required.
const PLAN_LIMITS = {
  developer:  { limit: 5000,     hardCap: true,  reportUsage: false, meterEvent: null },
  growth:     { limit: 25000,    hardCap: true,  reportUsage: false, meterEvent: null },
  scale:      { limit: 100000,   hardCap: true,  reportUsage: false, meterEvent: null },
  enterprise: { limit: Infinity, hardCap: false, reportUsage: false, meterEvent: null },
  payg:       { limit: Infinity, hardCap: false, reportUsage: true,  meterEvent: 'gph_api_call' },
};

function utcDay() { return new Date().toISOString().slice(0, 10); }

async function checkAccess(env, apiKey, request) {
  // Legacy keyed access (optional): a recognized, non-canceled key bypasses the anonymous daily cap.
  if (apiKey) {
    const kv = env?.GPH_API_KEYS;
    if (kv) {
      const raw = await kv.get(apiKey);
      if (raw) {
        const record = JSON.parse(raw);
        const planSpec = PLAN_LIMITS[record.plan];
        if (record.status !== 'canceled' && planSpec) {
          if (planSpec.hardCap && record.callsThisPeriod >= planSpec.limit) {
            return { allowed: false, reason: `Monthly quota reached (${planSpec.limit.toLocaleString()} calls on the ${record.plan} plan). For bulk or unmetered access, license the dataset at ${LICENSING_URL}` };
          }
          return { allowed: true, record, apiKey, planSpec };
        }
      }
    }
    // Unrecognized or canceled key: fall through to the free anonymous tier (never hard-block).
  }

  // Free anonymous tier — 100 calls/IP/day (UTC), rolling daily, no lifetime cap.
  const meter = env?.CALL_METER;
  if (meter) {
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const dayKey = `ip_daily:${ip}:${utcDay()}`;
    const count = parseInt(await meter.get(dayKey) || '0', 10);
    if (count >= DAILY_LIMIT) {
      return { allowed: false, reason: `Free tier limit reached (${DAILY_LIMIT} calls/IP/day; resets 00:00 UTC). For bulk or unmetered access, license the dataset at ${LICENSING_URL}` };
    }
    await meter.put(dayKey, String(count + 1), { expirationTtl: 172800 });
  }
  return { allowed: true, anonymous: true };
}

async function recordSuccessfulCall(env, validation) {
  if (!validation.record) return;
  const updated = {
    ...validation.record,
    callsThisPeriod: (validation.record.callsThisPeriod || 0) + 1,
    lastUsedAt: new Date().toISOString(),
  };
  await env.GPH_API_KEYS.put(validation.apiKey, JSON.stringify(updated));

  if (validation.planSpec.reportUsage && validation.planSpec.meterEvent) {
    await postMeterEvent(env, validation.planSpec.meterEvent, validation.record.customerId);
  }
}

async function postMeterEvent(env, eventName, customerId) {
  const stripeKey = env?.STRIPE_SECRET_KEY;
  if (!stripeKey || !customerId) return;
  const identifier = `${eventName}-${customerId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const body = new URLSearchParams({
    event_name: eventName,
    'payload[stripe_customer_id]': customerId,
    'payload[value]': '1',
    identifier,
  });
  try {
    const res = await fetch('https://api.stripe.com/v1/billing/meter_events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': identifier,
      },
      body,
    });
    if (!res.ok) throw new Error(`meter event ${res.status}`);
  } catch (e) {
    // Queue for later retry. Drained by cbeg-usage-reporter Worker (Phase 3.6).
    await env.GPH_API_KEYS.put(
      `usage_retry:${Date.now()}:${identifier}`,
      JSON.stringify({ eventName, customerId, identifier, timestamp: Date.now() }),
      { expirationTtl: 86400 * 7 }
    ).catch(() => {});
  }
}

// ============================================================================
// MCP demand-telemetry enrichment (D561, 2026-06-24) -- shared enrichment core, originally
// kept IDENTICAL in gth-mcp-server/functions/[[path]].js and the scratch canonical copy
// (_scratch/mcp-telemetry-2026-06-24/enrichment-canonical.js). NOTE (2026-07-01): this GPH
// copy now EXTENDS the core with practice-profile projections (practice_size, budget_range,
// practice_size_fit) + computeFieldCompleteness -- so it has DIVERGED from the GTH copy.
// The additions are server-generic (GTH branch in scoringArgsFor), so re-syncing GTH to this
// is a clean parity follow-up, not a rewrite. Logic is KV-free and
// network-free: caller_class is UA/Origin-only and deterministic at write time.
// Cadence-based crawler detection lives in the nightly rollup ONLY, and may only
// promote unknown -> known_crawler, never demote organic_assistant. The raw per-call
// row is immutable and honest.
// ============================================================================

const ASSISTANT_ORIGIN_HOSTS = {
  'chatgpt.com': 'chatgpt', 'openai.com': 'chatgpt', 'oai.com': 'chatgpt',
  'claude.ai': 'claude', 'claude.com': 'claude', 'anthropic.com': 'claude',
  'perplexity.ai': 'perplexity',
  'gemini.google.com': 'gemini',
};

function originHostOf(request) {
  const o = request.headers.get('Origin');
  if (!o) return '';
  try { return new URL(o).hostname.toLowerCase(); } catch { return ''; }
}

function assistantFromOrigin(host) {
  if (!host) return null;
  for (const h in ASSISTANT_ORIGIN_HOSTS) {
    if (host === h || host.endsWith('.' + h)) return ASSISTANT_ORIGIN_HOSTS[h];
  }
  return null;
}

function assistantFromUA(ua) {
  if (!ua) return null;
  if (/chatgpt|openai/i.test(ua)) return 'chatgpt';
  if (/claude|anthropic/i.test(ua)) return 'claude';
  if (/perplexity/i.test(ua)) return 'perplexity';
  if (/\bgemini\b|google-?bard/i.test(ua)) return 'gemini';
  if (/copilot/i.test(ua)) return 'copilot';
  return null;
}

function assistantChannel(ua, originHost) {
  return assistantFromOrigin(originHost) || assistantFromUA(ua);
}

function classifyCaller(ua, originHost) {
  if (assistantFromOrigin(originHost)) return 'organic_assistant';
  const u = (ua || '').trim();
  if (!u) return 'unknown';
  if (/probe|listability|uptime|pingdom|healthcheck|statuscake|\bmonitor\b/i.test(u)) return 'directory_probe';
  // SR-UA fix (2026-07-03): self_test requires a self-identifying cbeg-* UA (our
  // own harness, e.g. cbeg-floor-check). A generic HTTP client (python-httpx,
  // curl, wget, node-fetch, axios, ...) is EXTERNAL programmatic traffic, not our
  // test -- it must not be hidden as self_test. It falls through to known_crawler
  // below, which the nightly rollup excludes from organic (honest, not organic).
  if (/^cbeg-/i.test(u)) return 'self_test';
  if (assistantFromUA(u)) return 'organic_assistant';
  if (/bot\b|spider|crawl|chiark|slurp|bingpreview|facebookexternalhit|quality index|scraper|http-client|^curl|^wget|python-requests|python-httpx|\bhttpx\b|node-fetch|go-http-client|^axios|postman|insomnia/i.test(u)) return 'known_crawler';
  return 'unknown';
}

function funnelStep(tool) {
  if (tool === 'get_provider_detail' || tool === 'get_facility_detail') return 'drill';
  // list_categories is reference, not discover (S2): it carries no demand specification, and
  // classing it 'discover' would inflate the discover leg of the funnel with lookup traffic.
  if (tool === 'list_states' || tool === 'get_treatment_types' || tool === 'list_categories') return 'reference';
  return 'discover';
}

function demandCell(server, args) {
  const n = v => ((v == null ? '' : String(v)).trim().toLowerCase()) || '*';
  if (server === 'gth') return [n(args.treatment_type), n(args.state), n(args.city), n(args.insurance)].join('|');
  return [n(args.category), n(args.specialty), n(args.state), n(args.ehr_system)].join('|');
}

// Scoring-relevant args per tool (the demand-specification surface, excluding pagination).
// Reference/param-less tools return null (not a demand-spec call -> completeness N/A).
function scoringArgsFor(server, tool) {
  if (server === 'gth') {
    if (tool === 'search_facilities') return ['state', 'city', 'treatment_type', 'insurance'];
    if (tool === 'get_facility_detail') return ['name'];
    return null;
  }
  if (tool === 'match_practice') return ['category', 'specialty', 'practice_size', 'city', 'state', 'ehr_system', 'budget_range'];
  if (tool === 'search_providers') return ['category', 'state', 'city', 'min_rating', 'tier1_grade', 'practice_size_fit'];
  if (tool === 'get_provider_detail') return ['slug'];
  return null;
}

// 0-100 completeness of the scoring-relevant args actually supplied at call time. The real
// quality signal (supersedes the coarse 0-3 Signal Score). null for reference/param-less tools.
function computeFieldCompleteness(server, tool, args) {
  const fields = scoringArgsFor(server, tool);
  if (!fields || !fields.length) return null;
  const a = args || {};
  const present = fields.reduce((n, f) => n + ((a[f] != null && String(a[f]).trim() !== '') ? 1 : 0), 0);
  return Math.round((present / fields.length) * 100);
}

function telemetryUtcDay() { return new Date().toISOString().slice(0, 10); }

async function sha256hex(s) {
  const data = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Mcp-Session-Id (server-issued at initialize, client-echoed) is the load-bearing
// session key. Fallback for sessionless callers: salted hash of transient ip+ua with a
// daily-rotating salt -- raw ip/ua are NEVER stored as inputs, only the opaque derived
// id is stored. 'm:' = real MCP session, 'd:' = derived fallback.
async function deriveSessionId(request, env) {
  const incoming = request.headers.get('Mcp-Session-Id');
  if (incoming) return 'm:' + (await sha256hex(incoming)).slice(0, 16);
  const ip = request.headers.get('cf-connecting-ip') || '';
  const ua = request.headers.get('user-agent') || '';
  const salt = (env && env.SESSION_SALT ? env.SESSION_SALT : 'cbeg-mcp') + ':' + telemetryUtcDay();
  return 'd:' + (await sha256hex(salt + '|' + ip + '|' + ua)).slice(0, 16);
}

// TELEMETRY-COLUMNS-01 Set 3 (2026-08-06): vendor_eligible -- the ELIGIBLE rung of the
// selection funnel, the pool a query was chosen FROM.
//
// THIS IS THE PRIVACY BOUNDARY, and it is enforced here rather than trusted upstream. The
// rule ~40 lines below (search_term / query_text is INTENTIONALLY NOT CAPTURED on GPH,
// ruling 2026-07-01) exists because free-text healthcare input is the top PHI and
// re-identification risk on this surface. vendor_eligible must stay inside that rule.
//
// SLUGS ONLY. Every entry is re-validated against the bare-slug shape at this boundary
// even though /api/match generates them from providers.slug and they are never caller
// input. Structural prevention, not a comment: if a future /api/match change ever put a
// company name, a query echo, or anything else free-form into eligible_slugs, this filter
// drops it rather than writing it to a durable telemetry row. Capped at 25 and length-
// capped per entry for the same reason.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function sanitizeEligibleSlugs(list) {
  if (!Array.isArray(list)) return null;
  const clean = [];
  for (const s of list) {
    if (typeof s !== 'string') continue;
    const t = s.trim();
    if (!SLUG_RE.test(t)) continue;      // anything that is not a bare slug is DROPPED
    if (clean.includes(t)) continue;
    clean.push(t);
    if (clean.length >= 25) break;
  }
  return clean.length ? clean : null;
}

async function buildTelemetry(server, request, env, toolName, args, resultsCount, tier, ids, sessionId) {
  const ua = request.headers.get('user-agent') || '';
  const originHost = originHostOf(request);
  const step = funnelStep(toolName);
  const rc = (typeof resultsCount === 'number') ? resultsCount : null;
  const zero = (step !== 'reference' && rc === 0) ? 1 : 0;
  const a = args || {};
  return {
    ts: new Date().toISOString(),
    server,
    tool: toolName || '',
    caller_class: classifyCaller(ua, originHost),
    assistant_channel: assistantChannel(ua, originHost),
    source: 'mcp',
    user_agent: ua,
    referer: request.headers.get('referer') || null,
    country: (request.cf && request.cf.country) || null,
    // D850 adjudication: instrumentation-only IP-owner attribution. Additive, forward-only.
    asn: (request.cf && request.cf.asn) || null,
    as_organization: (request.cf && request.cf.asOrganization) || null,
    // Set 3: derived ONCE per request now and threaded in, so the value written here is
    // provably the same string forwarded to /api/match as X-GPH-MCP-Session-Id and stored
    // as match_sessions.mcp_session_id. Deriving it twice would work today but would let
    // the two drift the moment deriveSessionId gains any per-call state. Falls back to
    // deriving locally so this function keeps working standalone.
    session_id: sessionId || await deriveSessionId(request, env),
    funnel_step: step,
    zero_result: zero,
    results_count: rc,
    api_key_tier: tier || 'anonymous',
    category: a.category || null,
    specialty: a.specialty || null,
    city: a.city || null,
    state: a.state || null,
    ehr_system: a.ehr_system || null,
    treatment_type: a.treatment_type || null,
    insurance: a.insurance || null,
    // search_term / query_text: INTENTIONALLY NOT CAPTURED on GPH (ruling 2026-07-01). No GPH
    // tool accepts a free-text argument, so populating this would require a tool schema/contract
    // change (OpenAI-reviewable) AND free-text healthcare input is the top PHI/re-identification
    // risk. It is null for server='gph' BY DESIGN -- a null search_term on a gph row is NOT a
    // capture gap. (GTH legitimately populates it from get_facility_detail's required `name`.)
    // role: likewise structurally-null on the anonymous MCP surface (not an arg, not inferable).
    search_term: a.name || null,
    // GPH practice-profile projections: first-class dimensions for args that previously landed
    // only inside raw_args. Instrumentation only -- NO ranking/scoring effect (independence intact).
    practice_size: a.practice_size || null,
    budget_range: a.budget_range || null,
    practice_size_fit: a.practice_size_fit || null,
    field_completeness: computeFieldCompleteness(server, toolName, a),
    demand_cell: demandCell(server, a),
    vendor_surfaced: (ids && ids.surfaced && ids.surfaced.length) ? JSON.stringify(ids.surfaced) : null,
    vendor_drilled: (ids && ids.drilled) ? ids.drilled : null,
    // Set 3: the ELIGIBLE rung. vendor_surfaced above is RETURNED (top 5) and
    // match_sessions.results is SELECTED (top 10) -- with mcp_session_id now shared across
    // both databases, the three are chainable per query for the first time. Stored as a
    // JSON array of slugs; null (not '[]') when there is no candidate list, so "no eligible
    // pool recorded" stays distinguishable from "the pool was empty".
    vendor_eligible: (() => {
      const clean = sanitizeEligibleSlugs(ids && ids.eligible);
      return clean ? JSON.stringify(clean) : null;
    })(),
    raw_args: JSON.stringify(a),
  };
}

// Independent, non-blocking D1 sink. Own try/catch; never throws to the caller.
//
// TELEMETRY-COLUMNS-01 Set 3 (2026-08-06): TWO-ATTEMPT WRITE. vendor_eligible ships in
// migrations/2026_08_06_mcp_usage_log_vendor_eligible.sql, which is NOT applied to remote
// D1 by this change set. Naming a not-yet-existing column in the INSERT list would make the
// statement fail -- and because this function's catch only console.errors, EVERY telemetry
// row would be silently lost, not just the new field. So: attempt the full write, and on
// failure fall back to the exact pre-Set-3 column list. The row is never lost; the new
// column populates the moment the migration lands, with no further code change.
//
// The fallback is keyed on nothing but the error -- no schema probing, no PRAGMA, no cached
// capability flag that could go stale in the wrong direction.
const TELEMETRY_BASE_COLUMNS =
  `ts, server, tool, caller_class, assistant_channel, source, user_agent, session_id, funnel_step,
   zero_result, results_count, api_key_tier, category, specialty, city, state, ehr_system,
   treatment_type, insurance, search_term, demand_cell, vendor_surfaced, vendor_drilled, raw_args,
   practice_size, budget_range, practice_size_fit, field_completeness, country, referer,
   asn, as_organization`;

function telemetryBaseBinds(rec) {
  return [
    rec.ts, rec.server, rec.tool, rec.caller_class, rec.assistant_channel, rec.source, rec.user_agent,
    rec.session_id, rec.funnel_step, rec.zero_result, rec.results_count, rec.api_key_tier,
    rec.category, rec.specialty, rec.city, rec.state, rec.ehr_system,
    rec.treatment_type, rec.insurance, rec.search_term, rec.demand_cell,
    rec.vendor_surfaced, rec.vendor_drilled, rec.raw_args,
    rec.practice_size, rec.budget_range, rec.practice_size_fit, rec.field_completeness,
    rec.country, rec.referer, rec.asn, rec.as_organization,
  ];
}

function telemetryInsertSql(columns, bindCount) {
  return `INSERT INTO mcp_usage_log
        (${columns})
       VALUES (${new Array(bindCount).fill('?').join(',')})`;
}

async function writeTelemetryD1(env, rec) {
  const db = env && env.TELEMETRY_DB;
  if (!db) { console.error('writeTelemetryD1: TELEMETRY_DB not bound -- D1 telemetry skipped'); return; }
  const baseBinds = telemetryBaseBinds(rec);
  try {
    const binds = [...baseBinds, rec.vendor_eligible];
    await db.prepare(
      telemetryInsertSql(`${TELEMETRY_BASE_COLUMNS}, vendor_eligible`, binds.length)
    ).bind(...binds).run();
    return;
  } catch (e) {
    // Expected until the migration is applied. Logged at a distinct message so an ops read
    // can tell "column not there yet" apart from a genuinely broken telemetry sink.
    console.error('writeTelemetryD1: vendor_eligible write failed, retrying without it:', e && e.message);
  }
  try {
    await db.prepare(
      telemetryInsertSql(TELEMETRY_BASE_COLUMNS, baseBinds.length)
    ).bind(...baseBinds).run();
  } catch (e) {
    console.error('writeTelemetryD1: D1 telemetry write threw:', e && e.message);
  }
}

// ── MCP call logging to Airtable (Tier 1e) -- now the ENRICHED glanceable mirror ──

function computeSignalScore(rec) {
  let score = 0;
  if (rec.category) score = 1;
  if (rec.category && rec.state) score = 2;
  if (rec.category && rec.state && (rec.city || rec.specialty)) score = 3;
  return score;
}

// Independent, non-blocking Airtable sink. Own try/catch; never throws. Surfaces auth/
// schema failures so a dead write cannot go unseen again (the 2026-04-18 blind spot).
async function logToolCall(env, rec, request) {
  const atKey = env?.AIRTABLE_PAT;
  if (!atKey) { console.error('logToolCall: AIRTABLE_PAT not bound -- telemetry write skipped'); return; }
  let surfacedCount = 0;
  if (rec.vendor_surfaced) { try { surfacedCount = JSON.parse(rec.vendor_surfaced).length; } catch (e) {} }
  try {
    const res = await fetch(`https://api.airtable.com/v0/${AT_BASE}/${AT_LOG_TABLE}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${atKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: [{ fields: {
          'Tool Name': rec.tool,
          'Category': rec.category || '',
          'Specialty': rec.specialty || '',
          'City': rec.city || '',
          'State': rec.state || '',
          'EHR System': rec.ehr_system || '',
          'Results Count': rec.results_count || 0,
          'Signal Score': computeSignalScore(rec),
          'Timestamp': rec.ts,
          'API Key': rec.api_key_tier || 'anonymous',
          'User Agent': rec.user_agent || '',
          'Source': rec.source || '',
          'Caller Class': rec.caller_class,
          ...(rec.assistant_channel ? { 'Assistant Channel': rec.assistant_channel } : {}),
          'Session ID': rec.session_id || '',
          'Funnel Step': rec.funnel_step || '',
          'Zero Result': !!rec.zero_result,
          'Raw Args': rec.raw_args || '',
          'Demand Cell': rec.demand_cell || '',
          'Vendor Drilled': rec.vendor_drilled || '',
          'Vendor Surfaced Count': surfacedCount,
          'Vendors Surfaced': rec.vendor_surfaced || '',
          'Practice Size': rec.practice_size || '',
          'Budget Range': rec.budget_range || '',
          'Practice Size Fit': rec.practice_size_fit || '',
          ...(typeof rec.field_completeness === 'number' ? { 'Field Completeness': rec.field_completeness } : {}),
          'Country': (request && request.cf && request.cf.country) || '',
          'Referer': (request && request.headers.get('referer')) || '',
          ...(typeof rec.asn === 'number' ? { 'ASN': rec.asn } : {}),
          'AS Organization': rec.as_organization || ''
        }}],
        typecast: true
      })
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`logToolCall: Airtable telemetry write failed ${res.status} ${detail.slice(0, 200)}`);
      await env?.CALL_METER?.put('telemetry_last_fail', new Date().toISOString(), { expirationTtl: 172800 }).catch(() => {});
    }
  } catch (e) {
    console.error('logToolCall: Airtable telemetry write threw:', e && e.message);
    await env?.CALL_METER?.put('telemetry_last_fail', new Date().toISOString(), { expirationTtl: 172800 }).catch(() => {});
  }
}

// ── Request router ──

async function handleMcpRequest(body, env, apiKey, ctx) {
  const { jsonrpc: version, id, method, params } = body;

  if (version !== '2.0') return jsonrpcError(id, -32600, 'Invalid JSON-RPC version');

  switch (method) {
    case 'initialize':
      return jsonrpc(id, SERVER_INFO);

    case 'notifications/initialized':
      return null; // no response for notifications

    case 'tools/list':
      return jsonrpc(id, { tools: TOOLS });

    case 'tools/call': {
      const { name, arguments: args } = params || {};
      if (!name) return jsonrpcError(id, -32602, 'Missing tool name');

      const validation = await checkAccess(env, apiKey, ctx.request);
      if (!validation.allowed) {
        return jsonrpc(id, { content: [{ type: 'text', text: validation.reason }], isError: true });
      }

      // Set 3: derived ONCE here and used for BOTH the /api/match forward and the telemetry
      // row, so the value stored as match_sessions.mcp_session_id is provably the same
      // string stored as mcp_usage_log.session_id. That identity IS the join; deriving it
      // independently in two places would work today and silently stop working the moment
      // deriveSessionId gains any per-call state.
      const mcpSessionId = await deriveSessionId(ctx.request, env);

      // S3/S4: validate against the tool's own declared schema before serving. A rejection is
      // still telemetered (same row shape, results_count NULL -> zero_result stays 0, so a
      // rejection never masquerades as a genuine zero-result in the demand series).
      const result = validateArgs(name, args || {}) || await callTool(name, args || {}, mcpSessionId);

      // Enriched demand telemetry -> two INDEPENDENT non-blocking sinks (Airtable mirror +
      // D1 durable). Each has its own try/catch inside; allSettled so one sink's failure
      // never skips the other, and neither blocks the tool response.
      const tier = validation.anonymous ? 'anonymous' : (validation.record?.plan || 'keyed');
      const rec = await buildTelemetry('gph', ctx.request, env, name, args || {}, result.count, tier, result.ids, mcpSessionId);
      const telemetry = Promise.allSettled([logToolCall(env, rec, ctx.request), writeTelemetryD1(env, rec)]);
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(telemetry); else await telemetry;

      if (!result.isError) {
        const recording = recordSuccessfulCall(env, validation).catch(e => console.error('record failed:', e));
        if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(recording);
        else await recording;
      }

      return jsonrpc(id, result);
    }

    case 'prompts/list':
      return jsonrpc(id, { prompts: PROMPTS });

    case 'prompts/get': {
      const prompt = getPrompt(params?.name, params?.arguments);
      if (!prompt) return jsonrpcError(id, -32602, `Unknown prompt: ${params?.name}`);
      return jsonrpc(id, prompt);
    }

    case 'resources/list':
      return jsonrpc(id, { resources: [] });

    case 'resources/templates/list':
      return jsonrpc(id, { resourceTemplates: [] });

    case 'ping':
      return jsonrpc(id, {});

    default:
      return jsonrpcError(id, -32601, `Method not found: ${method}`);
  }
}

// ── Origin validation (MCP Streamable HTTP security requirement) ──
// Per the MCP spec, servers MUST validate the Origin header on all incoming connections
// to prevent DNS rebinding attacks. Non-browser MCP clients (Claude Desktop, mcp-remote,
// server-to-server) send no Origin and are allowed; browser requests must come from an
// allowed host.
const ALLOWED_ORIGIN_HOSTS = ['gph-mcp-server.pages.dev', 'claude.ai', 'claude.com', 'anthropic.com', 'chatgpt.com', 'openai.com', 'localhost', '127.0.0.1'];

function originAllowed(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true; // no Origin header = non-browser client; no DNS-rebinding vector
  let hostname;
  try { hostname = new URL(origin).hostname; } catch { return false; }
  return ALLOWED_ORIGIN_HOSTS.some(h => hostname === h || hostname.endsWith('.' + h));
}

// ── HTTP handler ──

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!originAllowed(request)) {
    return Response.json(jsonrpcError(null, -32600, 'Origin not allowed'), {
      status: 403,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
  const apiKey = request.headers.get('x-api-key') || '';

  try {
    const body = await request.json();

    // Handle batch requests
    if (Array.isArray(body)) {
      const results = [];
      for (const req of body) {
        const res = await handleMcpRequest(req, env, apiKey, context);
        if (res) results.push(res);
      }
      return Response.json(results, {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Single request
    const result = await handleMcpRequest(body, env, apiKey, context);
    if (!result) return new Response('', { status: 204 }); // notification, no response

    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    // Issue a server session id at initialize; the client echoes it via Mcp-Session-Id on
    // subsequent calls (the load-bearing session key for demand stitching). Expose so
    // browser-based clients can read it off the response.
    if (body && body.method === 'initialize') {
      headers['Mcp-Session-Id'] = crypto.randomUUID();
      headers['Access-Control-Expose-Headers'] = 'Mcp-Session-Id';
    }
    return Response.json(result, { headers });
  } catch (err) {
    return Response.json(jsonrpcError(null, -32700, `Parse error: ${err.message}`), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}

// Handle OPTIONS for CORS
export async function onRequestOptions(context) {
  const { request } = context;
  if (!originAllowed(request)) {
    return new Response(null, { status: 403 });
  }
  const origin = request.headers.get('Origin');
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-api-key, Mcp-Session-Id, MCP-Protocol-Version',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    },
  });
}

// Handle GET with SSE info
export async function onRequestGet() {
  return Response.json({
    name: 'gph-intelligence',
    version: '1.1.1',
    description: 'GPH Intelligence MCP Server: Find healthcare service providers for medical practices.',
    mcp_endpoint: 'POST /mcp',
    documentation: 'https://www.getpracticehelp.com/providers/',
  }, {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
