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

const TOOLS = [
  {
    name: 'match_practice',
    title: 'Recommend Healthcare Vendors for a Practice',
    description: `Recommend and rank the best healthcare vendors for a specific medical practice. Use this when a practice manager, physician, or administrator asks for a recommendation, e.g. "recommend a medical billing / RCM company for my practice", "who should I use for credentialing / payer enrollment", "find an EHR for my small [specialty] practice", or "which practice-management software fits a [size] practice in [city, state]". Scores and ranks providers against the practice profile (specialty, size, location, EHR system, budget) and returns up to 5 merit-ranked matches (quality-scored, no paid placement) with {company_name, category, city, state_abbr, quality_score (0-100), final_score (0-100), verified status, description, website, profile_url, slug}. For open-ended browsing without a practice profile, use search_providers. Pass a match's slug to get_provider_detail for the full profile.`,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: "Service category needed (e.g. 'Medical Billing & RCM', 'Credentialing Services', 'Healthcare IT & EHR', 'Practice Management Software')" },
        specialty: { type: 'string', description: "Medical specialty of the practice (e.g. 'Family Medicine', 'Cardiology', 'Pediatrics', 'Dermatology')" },
        practice_size: { type: 'string', description: 'Size of the practice by provider count', enum: ['Solo', 'Small', 'Mid-size', 'Large'] },
        city: { type: 'string', description: 'City where the practice is located' },
        state: { type: 'string', description: "Two-letter state abbreviation (e.g. 'TX', 'CA', 'NY')" },
        ehr_system: { type: 'string', description: "EHR system used by the practice (e.g. 'Epic', 'athenahealth', 'AdvancedMD', 'eClinicalWorks'). Helps score providers with compatible integrations higher." },
        budget_range: { type: 'string', description: 'Approximate monthly budget', enum: ['Under $500', '$500-$2,000', '$2,000-$5,000', '$5,000+', 'Not sure'] },
      },
      required: ['category', 'state'],
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
        category: { type: 'string', description: "Service category to search (e.g. 'Medical Billing & RCM', 'Credentialing Services')" },
        state: { type: 'string', description: "Two-letter state abbreviation (e.g. 'TX'). National providers always included." },
        city: { type: 'string', description: 'City name to filter by (partial match supported)' },
        min_rating: { type: 'number', description: 'Minimum quality score (0-100). Most providers score 50-85.', minimum: 0, maximum: 100 },
        tier1_grade: { type: 'string', enum: ['A', 'B'], description: "Filter to the curated Tier-1 provider set by grade: 'A' (top-graded) or 'B' (strong). Tier-1 is a hand-reviewed ~4,400-provider subset; most directory records are not Tier-1, so this narrows results sharply. Omit to search the full directory." },
        practice_size_fit: { type: 'string', enum: ['Solo/Small', 'Mid-size', 'Large', 'All'], description: 'Filter providers by the practice size they best serve.' },
        per_page: { type: 'number', description: 'Results per page (1-25, default 10)', minimum: 1, maximum: 25, default: 10 },
        page: { type: 'number', description: 'Page number for pagination (default 1)', minimum: 1, default: 1 },
      },
      required: ['category'],
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

async function callTool(name, args) {
  if (name === 'match_practice') {
    const res = await fetch(`${API_BASE}/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const data = await res.json();
    if (!data.success) return { content: [{ type: 'text', text: `Match failed: ${data.error || 'Unknown error'}` }], isError: true };

    const matches = (data.matches || []).slice(0, 5);
    const text = matches.length === 0
      ? 'No matching providers found for your criteria. Try broadening your search (e.g. remove city filter or change category).'
      : matches.map((m, i) => [
          `${i + 1}. **${m.company_name}**`,
          `   Category: ${m.category}`,
          `   Location: ${m.city || 'National'}, ${m.state_abbr || 'US'}`,
          `   Quality Score: ${m.quality_score}/100${m.verified ? ' ✓ Verified' : ''}`,
          `   Match Score: ${m.final_score}/100`,
          m.description ? `   ${m.description.substring(0, 150)}...` : '',
          m.website ? `   Website: ${m.website}` : '',
          `   Profile: https://www.getpracticehelp.com/providers/${m.slug}/`,
        ].filter(Boolean).join('\n')).join('\n\n');

    return { content: [{ type: 'text', text: `Found ${data.total || matches.length} providers. Top ${matches.length} matches:\n\n${text}` }], count: data.total ?? matches.length, ids: { surfaced: matches.map(m => m.slug).filter(Boolean) } };
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
    if (!res.ok) return { content: [{ type: 'text', text: `Provider not found: ${args.slug}` }], isError: true };

    const data = await res.json();
    if (!data.success || !data.provider) return { content: [{ type: 'text', text: `Provider not found: ${args.slug}` }], isError: true };
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
// MCP demand-telemetry enrichment (D561, 2026-06-24) -- CANONICAL block, kept
// IDENTICAL in gth-mcp-server/functions/[[path]].js and the scratch canonical copy
// (_scratch/mcp-telemetry-2026-06-24/enrichment-canonical.js). Logic is KV-free and
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
  if (/^curl|^wget|python-requests|python-httpx|\bhttpx\b|node-fetch|go-http-client|^axios|cbeg-floor-check|postman|insomnia/i.test(u)) return 'self_test';
  if (assistantFromUA(u)) return 'organic_assistant';
  if (/bot\b|spider|crawl|chiark|slurp|bingpreview|facebookexternalhit|quality index|scraper|http-client/i.test(u)) return 'known_crawler';
  return 'unknown';
}

function funnelStep(tool) {
  if (tool === 'get_provider_detail' || tool === 'get_facility_detail') return 'drill';
  if (tool === 'list_states' || tool === 'get_treatment_types') return 'reference';
  return 'discover';
}

function demandCell(server, args) {
  const n = v => ((v == null ? '' : String(v)).trim().toLowerCase()) || '*';
  if (server === 'gth') return [n(args.treatment_type), n(args.state), n(args.city), n(args.insurance)].join('|');
  return [n(args.category), n(args.specialty), n(args.state), n(args.ehr_system)].join('|');
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

async function buildTelemetry(server, request, env, toolName, args, resultsCount, tier, ids) {
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
    session_id: await deriveSessionId(request, env),
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
    search_term: a.name || null,
    demand_cell: demandCell(server, a),
    vendor_surfaced: (ids && ids.surfaced && ids.surfaced.length) ? JSON.stringify(ids.surfaced) : null,
    vendor_drilled: (ids && ids.drilled) ? ids.drilled : null,
    raw_args: JSON.stringify(a),
  };
}

// Independent, non-blocking D1 sink. Own try/catch; never throws to the caller.
async function writeTelemetryD1(env, rec) {
  const db = env && env.TELEMETRY_DB;
  if (!db) { console.error('writeTelemetryD1: TELEMETRY_DB not bound -- D1 telemetry skipped'); return; }
  try {
    await db.prepare(
      `INSERT INTO mcp_usage_log
        (ts, server, tool, caller_class, assistant_channel, source, user_agent, session_id, funnel_step,
         zero_result, results_count, api_key_tier, category, specialty, city, state, ehr_system,
         treatment_type, insurance, search_term, demand_cell, vendor_surfaced, vendor_drilled, raw_args)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      rec.ts, rec.server, rec.tool, rec.caller_class, rec.assistant_channel, rec.source, rec.user_agent,
      rec.session_id, rec.funnel_step, rec.zero_result, rec.results_count, rec.api_key_tier,
      rec.category, rec.specialty, rec.city, rec.state, rec.ehr_system,
      rec.treatment_type, rec.insurance, rec.search_term, rec.demand_cell,
      rec.vendor_surfaced, rec.vendor_drilled, rec.raw_args
    ).run();
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
async function logToolCall(env, rec) {
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
          'Vendor Surfaced Count': surfacedCount
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

      const result = await callTool(name, args || {});

      // Enriched demand telemetry -> two INDEPENDENT non-blocking sinks (Airtable mirror +
      // D1 durable). Each has its own try/catch inside; allSettled so one sink's failure
      // never skips the other, and neither blocks the tool response.
      const tier = validation.anonymous ? 'anonymous' : (validation.record?.plan || 'keyed');
      const rec = await buildTelemetry('gph', ctx.request, env, name, args || {}, result.count, tier, result.ids);
      const telemetry = Promise.allSettled([logToolCall(env, rec), writeTelemetryD1(env, rec)]);
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
