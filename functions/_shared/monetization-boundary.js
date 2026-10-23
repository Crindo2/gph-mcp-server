// C785/C787: placement records never participate in organic results. These are
// entry markers, not vendor membership/plan fields: an independently ranked vendor
// may also buy a separate placement without changing its organic inclusion/order.
export function isSponsoredEntry(row) {
  return row?.sponsored === true || row?.sponsored === 1 || row?.sponsored === '1' ||
    row?.is_sponsored === true || row?.is_sponsored === 1 || row?.is_sponsored === '1' ||
    row?.entry_type === 'sponsored' || row?.placement_type === 'sponsored';
}

// Only public eligibility assertions cross this boundary; no contact address or
// inquiry data is needed. Missing/stale/revoked eligibility must be false upstream.
// S3 owns verification, freshness and dispatch-time rechecks, consent and POST flow.
export function quotesLink(row, env) {
  if (env?.MCP_GET_QUOTES_ENABLED !== '1' || row?.quotes_contact_deliverable !== true ||
      !['claimed_profile', 'verified_sales'].includes(row.quotes_contact_source) ||
      typeof row.slug !== 'string' || !/^[a-z0-9-]+$/.test(row.slug)) return '';
  try {
    const url = new URL(env.MCP_GET_QUOTES_URL);
    // This build is staging only. No production route is presumed to exist.
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.pages.dev') ||
        url.username || url.password || url.port || url.search || url.hash) return '';
    url.searchParams.set('vendor', row.slug);
    url.searchParams.set('source', 'mcp');
    return `   Get Quotes: ${url.href}`;
  } catch { return ''; }
}

// Defense at the upstream JSON boundary, including the otherwise verbatim EHR
// projection. Public profile fields retain their existing rendering allowlists.
// Private inquiry objects/fields must never be echoed if accidentally joined in.
const PRIVATE_INQUIRY_KEYS = new Set([
  '_private', 'inquiry', 'inquiries', 'inquiry_rows', 'inquiry_details',
  'work_email', 'practice_email', 'practice_details', 'provider_count',
  'current_system', 'timeline', 'short_note', 'consent', 'consent_token',
  'confirmation_token', 'withdrawal_token', 'recipient_email', 'contact_email',
]);
export function publicToolData(value) {
  if (Array.isArray(value)) return value.map(publicToolData);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !PRIVATE_INQUIRY_KEYS.has(key))
    .map(([key, child]) => [key, publicToolData(child)]));
}
