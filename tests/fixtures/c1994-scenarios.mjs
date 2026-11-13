// C1994 s.3: scenario set for the attribution line-break golden. Mock payloads only; no network.
import { readFileSync } from 'node:fs';
import { SCENARIOS, OFFER } from './c1984-scenarios.mjs';
const ehr = JSON.parse(readFileSync(new URL('./ehr-product-detail.json', import.meta.url), 'utf8'));
const counts = { schema_version: 1, as_of: '2026-11-04', unit: 'practices (headline evidence)', min_cell: 25,
  states: [{ state: 'TX', segments: [{ segment_code: 'X', segment_slug: 'other', label: 'Other', count: null, suppressed: true }] }] };
const P = (i) => ({ slug: `fixture-${i}`, company_name: `Fixture ${i}`, category: 'Medical Billing', city: 'Austin', state_abbr: 'TX', quality_score: 75, phone: '555-0100', website: `https://fixture${i}.example/` });
const ok = body => ({ ok: true, status: 200, json: async () => body });
export const OTHER = {
  list_categories: { tool: 'list_categories', args: {}, route: () => ok({ success: true, categories: [{ category: 'Medical Billing', providers: 3536 }], total_providers: 3536 }) },
  list_categories_fail: { tool: 'list_categories', args: {}, route: () => ({ ok: false, status: 500, json: async () => ({}) }) },
  search_ok: { tool: 'search_providers', args: { category: 'Medical Billing', state: 'TX' }, route: () => ok({ success: true, providers: [P(1), P(2)], pagination: { total: 2 } }) },
  search_empty: { tool: 'search_providers', args: { category: 'Medical Billing' }, route: () => ok({ success: true, providers: [], pagination: { total: 0 } }) },
  search_fail: { tool: 'search_providers', args: { category: 'Medical Billing' }, route: () => ok({ success: false, error: 'boom' }) },
  provider_ok: { tool: 'get_provider_detail', args: { slug: 'fixture-1' }, route: () => ok({ success: true, provider: { ...P(1), description: 'A vendor.' } }) },
  provider_missing: { tool: 'get_provider_detail', args: { slug: 'nope' }, route: () => ({ ok: false, status: 404, json: async () => ({}) }) },
  provider_no_slug: { tool: 'get_provider_detail', args: {}, route: () => ok({}) },
  ehr_ok: { tool: 'get_ehr_product_detail', args: { product_key: 'nextgen-healthcare' }, route: () => ok(ehr) },
  ehr_not_found: { tool: 'get_ehr_product_detail', args: { product_key: 'nextgen-healthcare' }, route: () => ok({ schema_version: '1.0.0', error: 'product_not_found' }) },
  counts_ok: { tool: 'practice_data_counts', args: {}, route: () => ok(counts) },
  counts_state: { tool: 'practice_data_counts', args: { state: 'TX' }, route: () => ok(counts) },
};
export async function captureAll(mcp) {
  const { callTool, serveTool, handleMcpRequest, TOOLS } = mcp;
  const real = globalThis.fetch;
  const out = { tools_list: TOOLS, replies: {} };
  const run = async (key, route, fn) => { globalThis.fetch = async () => route(); try { out.replies[key] = JSON.parse(JSON.stringify(await fn())); } finally { globalThis.fetch = real; } };
  for (const [n, s] of Object.entries(SCENARIOS)) {
    await run(`match_practice/${n}`, () => ok(s.data), () => callTool('match_practice', s.args));
    if (n !== 'no_results' && n !== 'api_failure') await run(`match_practice/${n}+offer`, () => ok({ ...s.data, decision_report: OFFER }), () => callTool('match_practice', s.args));
  }
  for (const [n, s] of Object.entries(OTHER)) {
    await run(`${s.tool}/${n}`, s.route, () => callTool(s.tool, s.args));
    if (s.tool === 'search_providers') await run(`${s.tool}/${n}/serveTool`, s.route, async () => (await serveTool(s.tool, s.args)).result);
  }
  return out;
}
