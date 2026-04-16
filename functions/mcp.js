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
  serverInfo: { name: 'gph-intelligence', version: '1.0.0' },
  capabilities: { tools: {}, prompts: {}, resources: {} },
};

const TOOLS = [
  {
    name: 'match_practice',
    title: 'Match Practice to Providers',
    description: "Score and rank healthcare service providers for a specific medical practice profile (specialty, size, location, EHR system, budget). Returns up to 5 ranked matches with {company_name, category, city, state_abbr, quality_score (0-100), final_score (0-100), verified status, description, website, profile_url, slug}. Use this when the user has practice-specific criteria and wants scored recommendations — for open-ended browsing, use search_providers instead. Pass a match's slug to get_provider_detail for the full profile.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
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
    title: 'Search Provider Directory',
    description: 'Paginated browse of the healthcare service provider directory filtered by category, location, and minimum quality score. Returns a page of providers with {company_name, category, city, state_abbr, quality_score (0-100), verified status, contact info, slug}. Use this for open-ended exploration and filtering — for scored recommendations to a specific practice profile, use match_practice instead. Pass a returned slug to get_provider_detail for the full profile.',
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: "Service category to search (e.g. 'Medical Billing & RCM', 'Credentialing Services')" },
        state: { type: 'string', description: "Two-letter state abbreviation (e.g. 'TX'). National providers always included." },
        city: { type: 'string', description: 'City name to filter by (partial match supported)' },
        min_rating: { type: 'number', description: 'Minimum quality score (0-100). Most providers score 50-85.', minimum: 0, maximum: 100 },
        per_page: { type: 'number', description: 'Results per page (1-50, default 10)', minimum: 1, maximum: 50, default: 10 },
        page: { type: 'number', description: 'Page number for pagination (default 1)', minimum: 1, default: 1 },
      },
      required: ['category'],
    },
  },
  {
    name: 'get_provider_detail',
    title: 'Get Provider Detail',
    description: "Get the full profile of one healthcare service provider identified by slug: full description, services offered, contact information (phone, email, website), quality_score (0-100), verified status, and user reviews. Slug comes from match_practice or search_providers results. Returns an error if the slug is unknown.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
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

    return { content: [{ type: 'text', text: `Found ${data.total || matches.length} providers. Top ${matches.length} matches:\n\n${text}` }] };
  }

  if (name === 'search_providers') {
    const params = new URLSearchParams();
    if (args.category) params.set('category', args.category);
    if (args.state) params.set('state', args.state);
    if (args.city) params.set('city', args.city);
    if (args.min_rating) params.set('min_rating', args.min_rating);
    params.set('per_page', Math.min(args.per_page || 10, 50));
    params.set('page', args.page || 1);

    const res = await fetch(`${API_BASE}/search?${params}`);
    const data = await res.json();
    if (!data.success) return { content: [{ type: 'text', text: `Search failed: ${data.error || 'Unknown error'}` }], isError: true };

    const providers = data.providers || [];
    const text = providers.length === 0
      ? 'No providers found matching your criteria.'
      : providers.map((p, i) => [
          `${i + 1}. **${p.company_name}** — ${p.city || 'National'}, ${p.state_abbr || 'US'}`,
          `   Quality: ${p.quality_score}/100${p.verified ? ' ✓ Verified' : ''}`,
          `   Category: ${p.category}`,
          p.phone ? `   Phone: ${p.phone}` : '',
          p.website ? `   Website: ${p.website}` : '',
        ].filter(Boolean).join('\n')).join('\n\n');

    return { content: [{ type: 'text', text: `${data.total || providers.length} total results (page ${args.page || 1}):\n\n${text}` }] };
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

    return { content: [{ type: 'text', text }] };
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

// ── KV Metering — IP abuse layer + anonymous lifetime tier ──

const FREE_LIMIT = 25;        // anonymous lifetime per IP
const ABUSE_LIMIT = 10;       // per hour per IP (applies to keyed + anonymous)

async function checkAndMeterCall(env, apiKey, request) {
  const kv = env?.CALL_METER;
  if (!kv) return { allowed: true, callCount: 0 }; // KV not bound, allow

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';

  // Layer 1: IP abuse detection (10/hr per IP) — applies to BOTH keyed and anonymous
  const abuseKey = `ip_abuse:${ip}`;
  const abuseCount = parseInt(await kv.get(abuseKey) || '0');
  if (abuseCount >= ABUSE_LIMIT) {
    return {
      allowed: false,
      reason: 'Rate limit exceeded. Please register for an API key at https://www.getpracticehelp.com/api-access/'
    };
  }
  await kv.put(abuseKey, String(abuseCount + 1), { expirationTtl: 3600 });

  // Keyed users bypass the lifetime tier (existing API key infrastructure handles them)
  if (apiKey) return { allowed: true, callCount: 0 };

  // Layer 2: Anonymous lifetime tier (25 per IP, no TTL)
  const permKey = `anon:perm:${ip}`;
  const current = parseInt(await kv.get(permKey) || '0');
  if (current >= FREE_LIMIT) {
    return {
      allowed: false,
      callCount: current,
      reason: "You've used your 25 free queries. Register at https://www.getpracticehelp.com/api-access/ with your email to get a free API key — no credit card required. Paid plans from $149/mo for unlimited access."
    };
  }
  await kv.put(permKey, String(current + 1)); // no TTL = permanent per-IP lifetime counter
  return { allowed: true, callCount: current + 1 };
}

// ── MCP call logging to Airtable (Tier 1e) ──

function computeSignalScore(args) {
  let score = 0;
  if (args.category) score = 1;
  if (args.category && args.state) score = 2;
  if (args.category && args.state && (args.city || args.specialty)) score = 3;
  return score;
}

async function logToolCall(env, toolName, args, resultsCount, apiKey) {
  const atKey = env?.AIRTABLE_PAT;
  if (!atKey) return;
  try {
    await fetch(`https://api.airtable.com/v0/${AT_BASE}/${AT_LOG_TABLE}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${atKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: [{ fields: {
          'Tool Name': toolName,
          'Category': args.category || '',
          'Specialty': args.specialty || '',
          'City': args.city || '',
          'State': args.state || '',
          'EHR System': args.ehr_system || '',
          'Results Count': resultsCount || 0,
          'Signal Score': computeSignalScore(args),
          'Timestamp': new Date().toISOString(),
          'API Key': apiKey ? '...' + apiKey.slice(-4) : 'anonymous'
        }}],
        typecast: true
      })
    });
  } catch (e) { /* non-blocking */ }
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

      // Check rate limit
      const meter = await checkAndMeterCall(env, apiKey, ctx.request);
      if (!meter.allowed) {
        return jsonrpc(id, { content: [{ type: 'text', text: meter.reason }], isError: true });
      }

      const result = await callTool(name, args || {});
      await logToolCall(env, name, args || {}, 0, apiKey);
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

// ── HTTP handler ──

export async function onRequestPost(context) {
  const { request, env } = context;
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

    return Response.json(result, {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    return Response.json(jsonrpcError(null, -32700, `Parse error: ${err.message}`), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}

// Handle OPTIONS for CORS
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
      'Access-Control-Max-Age': '86400',
    },
  });
}

// Handle GET with SSE info
export async function onRequestGet() {
  return Response.json({
    name: 'gph-intelligence',
    version: '1.0.0',
    description: 'GPH Intelligence MCP Server — Find healthcare service providers for medical practices.',
    mcp_endpoint: 'POST /mcp',
    documentation: 'https://www.getpracticehelp.com/providers/',
  }, {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
