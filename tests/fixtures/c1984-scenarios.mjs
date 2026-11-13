// C1984: shared scenario inputs for the byte-identity golden. Mock API payloads only; no network.
const M = (i, extra = {}) => ({ slug: `fixture-${i}`, company_name: `Fixture ${i}`, category: 'Medical Billing', city: 'Austin', state_abbr: 'TX', quality_score: 75, final_score: 90 - i, description: 'A fixture vendor description that is long enough to be truncated at one hundred and fifty characters so the ellipsis path runs here.', website: `https://fixture${i}.example/`, ...extra });
export const SCENARIOS = {
  one_match: { args: { category: 'Medical Billing', state: 'TX' }, data: { success: true, total: 1, matches: [M(1)] } },
  six_matches_sliced_to_five: { args: { category: 'Medical Billing', state: 'TX' }, data: { success: true, total: 6, matches: [1, 2, 3, 4, 5, 6].map(i => M(i)) } },
  with_evidence_and_summary: {
    args: { category: 'Medical Billing', state: 'TX', service_needs: ['BILLING_DENIAL_MANAGEMENT'] },
    data: { success: true, total: 2, needs_summary: { requested: 1, evidenced_any: 1, unknown: 0 }, matches: [M(1, { national_label: 'National vendor', geo_basis: 'state', evidence_checked: '2026-10-01' }), M(2, { regional_label: 'Regional vendor' })] },
  },
  honesty_note: { args: { category: 'Medical Billing', state: 'TX' }, data: { success: true, total: 1, geo_honesty_note: 'All results are national vendors.', matches: [M(1)] } },
  no_results: { args: { category: 'Medical Billing', state: 'TX' }, data: { success: true, total: 0, matches: [] } },
  api_failure: { args: { category: 'Medical Billing', state: 'TX' }, data: { success: false, error: 'boom' } },
};
export const OFFER = { available: true, what_it_adds: 'You have the list. This tells you which two to call first.', url: 'https://www.getpracticehelp.com/decision-report/?s=abc' };
export async function runScenario(callTool, name, tool = 'match_practice', patch = {}) {
  const s = SCENARIOS[name];
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ...s.data, ...patch }) });
  try { return await callTool(tool, s.args); } finally { globalThis.fetch = real; }
}
