// C2284 s.5 (row 58): every tool result may carry ONE extra field, `page_pointer`:
//   { url, description }
// the GetPracticeHelp page that best matches the result, and one plain line on what a reader finds there.
//
// RULES (all pinned by tests/page-pointers.test.mjs):
//  - The url carries exactly one constant marker, utm_source=mcp-page-pointer, so a click counts as
//    assistant-referred. No person data, no session id, nothing derived from the caller.
//  - No match, no field. A result with no page of its own (an error, an empty result, a product with no
//    page that covers it, an unknown category, a state with no guide) returns the result unchanged.
//  - No invented addresses. Fixed pages come from the site's own sitemaps (checked to answer 200 by
//    scripts/check-page-pointers.mjs, record in tests/fixtures/page-pointers-verified.json). The one dynamic
//    shape, a provider page, is built only from the provider's own stored record by the same rule the site uses
//    for its canonical address (/providers/<category>/<state or us>/<city or national>/<slug>/).
//  - The pointer sits beside the existing C1569 citation (`source`, `url`) and never alters it or the content.
const SITE = 'https://www.getpracticehelp.com';
export const POINTER_MARKER_KEY = 'utm_source';
export const POINTER_MARKER_VALUE = 'mcp-page-pointer';

// The 25 directory categories and their hub slug (from /api/categories, which is the site's own record).
export const CATEGORY_SLUGS = new Map([
  ['Medical Billing & RCM', 'medical-billing-rcm'],
  ['Credentialing Services', 'credentialing-services'],
  ['Healthcare IT & EHR', 'healthcare-it-ehr'],
  ['Practice Management Consulting', 'practice-management-consulting'],
  ['Healthcare Legal Services', 'healthcare-legal-services'],
  ['Healthcare CPA & Tax Advisory', 'healthcare-cpa-tax-advisory'],
  ['Medical Coding Services', 'medical-coding-services'],
  ['Healthcare Staffing & Recruiting', 'healthcare-staffing-recruiting'],
  ['Healthcare Marketing & Reputation Management', 'healthcare-marketing-reputation'],
  ['Compliance & HIPAA Services', 'compliance-hipaa-services'],
  ['Medical Equipment & Supplies', 'medical-equipment-supplies'],
  ['Healthcare Real Estate & Site Selection', 'healthcare-real-estate'],
  ['Practice Financing & Loans', 'practice-financing-loans'],
  ['Healthcare Construction & Facilities', 'healthcare-construction-facilities'],
  ['Healthcare Signage & Wayfinding', 'healthcare-signage-wayfinding'],
  ['Medical Waste & Environmental Services', 'medical-waste-environmental'],
  ['Healthcare Insurance & Malpractice Brokers', 'healthcare-insurance-malpractice'],
  ['Practice Valuation & Brokerage', 'practice-valuation-brokerage'],
  ['Patient Financing & Payment Solutions', 'patient-financing-payment'],
  ['Medical Transcription & Documentation', 'medical-transcription-documentation'],
  ['Pharmacy & Medication Management', 'pharmacy-medication-management'],
  ['Telehealth & Virtual Care Infrastructure', 'telehealth-virtual-care'],
  ['Laboratory & Diagnostics Services', 'laboratory-diagnostics-services'],
  ['Group Purchasing Organizations (GPOs)', 'group-purchasing-organizations'],
  ['Healthcare PR & Communications', 'healthcare-pr-communications'],
]);

// Categories that have a dedicated guide or ranked page, which is a better answer than the plain directory hub.
const CATEGORY_GUIDES = {
  'medical-billing-rcm': { path: '/medical-billing-rcm/best-medical-billing-companies/', what: 'Billing companies compared by specialty fit and practice size, with the pricing models they use and what to ask before you sign.' },
  'credentialing-services': { path: '/credentialing/best-credentialing-companies/', what: 'Credentialing services compared on turnaround, payer coverage and price, plus the questions that tell a strong one from a weak one.' },
  'practice-management-consulting': { path: '/practice-consulting/best-practice-management-consulting/', what: 'What each kind of practice management consultant does, and how to pick the one that fits an independent practice.' },
};

// State guides that list the firms in one state. Only built for the two categories that have them.
const STATE_NAMES = { az: 'Arizona', ca: 'California', co: 'Colorado', fl: 'Florida', ga: 'Georgia', il: 'Illinois', ma: 'Massachusetts', md: 'Maryland', mi: 'Michigan', mn: 'Minnesota', nc: 'North Carolina', nj: 'New Jersey', ny: 'New York', oh: 'Ohio', pa: 'Pennsylvania', tn: 'Tennessee', tx: 'Texas' };
const STATE_GUIDES = {
  'medical-billing-rcm': { prefix: '/guides/medical-billing-', states: 'az,ca,co,fl,ga,il,ma,md,mi,mn,nc,nj,ny,oh,pa,tn,tx', what: (n) => `The billing companies in ${n} whose own websites say they work with practices, grouped by specialty.` },
  'credentialing-services': { prefix: '/guides/credentialing-services-', states: 'ca,fl,ga,mi,ny,tx', what: (n) => `The credentialing firms in ${n} whose own websites say they do credentialing or payer enrollment for practices.` },
};

// Practice Data coverage pages: one per state and segment (from /sitemaps/data.xml).
export const COVERAGE = {
  ak: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  al: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  ar: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  az: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  ca: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  co: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  ct: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  dc: 'behavioral-health,dental,primary-care,pt-ot-speech,specialty-clinics',
  de: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  fl: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  ga: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  hi: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  ia: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  id: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  il: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  in: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  ks: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  ky: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  la: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  ma: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  md: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  me: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  mi: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  mn: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  mo: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  ms: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  mt: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  nc: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  nd: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  ne: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  nh: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  nj: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  nm: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  nv: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  ny: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  oh: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  ok: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  or: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  pa: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  ri: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  sc: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  sd: 'behavioral-health,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  tn: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  tx: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  ut: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  va: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  vt: 'behavioral-health,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  wa: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  wi: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  wv: 'behavioral-health,dental,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
  wy: 'behavioral-health,derm-peds-vision-podiatry,primary-care,pt-ot-speech,specialty-clinics',
};
const SEGMENT_NAMES = { 'primary-care': 'primary care', dental: 'dental', 'pt-ot-speech': 'physical, occupational and speech therapy', 'specialty-clinics': 'specialty clinic', 'behavioral-health': 'behavioral health', 'derm-peds-vision-podiatry': 'dermatology, pediatric, vision and podiatry' };

// EHR products. product_key is the exact key the tool takes. `page` is the one page that covers the product:
// the ranked comparison where the product is ranked, otherwise the pricing page that lists it. Display names
// are the public vendor product names.
export const EHR_PAGES = {
  ranked_small: { path: '/ehr/best-ehr-small-practices/', what: (n) => `${n} compared with the other EHRs small practices use, scored on cost, support and specialty fit.` },
  ranked_mental_health: { path: '/ehr/best-ehr-mental-health-practices-2026/', what: (n) => `${n} compared with the other EHRs that mental health practices use, by solo, group and billing needs.` },
  pricing: { path: '/ehr/ehr-pricing-transparency/', what: (n) => `Whether ${n} publishes a price on its own site, set beside 17 other EHR vendors and dated.` },
};
export const EHR_PRODUCTS = {
  advancedmd: ['AdvancedMD', 'ranked_small'], athenahealth: ['athenahealth', 'ranked_small'], charmhealth: ['CharmHealth EHR', 'ranked_small'],
  drchrono: ['DrChrono', 'ranked_small'], eclinicalworks: ['eClinicalWorks', 'ranked_small'], 'elation-health': ['Elation Health EHR', 'ranked_small'],
  'jane-app': ['Jane App', 'ranked_small'], 'nextgen-healthcare': ['NextGen Healthcare', 'ranked_small'], 'practice-fusion-ehr': ['Practice Fusion EHR', 'ranked_small'],
  rxnt: ['RXNT', 'ranked_small'], simplepractice: ['SimplePractice', 'ranked_small'], tebra: ['Tebra', 'ranked_small'], upheal: ['Upheal', 'ranked_small'],
  icanotes: ['ICANotes', 'ranked_mental_health'], theranest: ['TheraNest', 'ranked_mental_health'], therapynotes: ['TherapyNotes', 'ranked_mental_health'], valant: ['Valant', 'ranked_mental_health'],
  epic: ['Epic', 'pricing'], 'oracle-health-cerner': ['Oracle Health', 'pricing'],
};

const mark = (path) => {
  const u = new URL(path, SITE);
  u.searchParams.set(POINTER_MARKER_KEY, POINTER_MARKER_VALUE);
  return u.toString();
};
const pointer = (path, description) => ({ url: mark(path), description });

const categoryName = (name) => (typeof name === 'string' ? name : '');

// A category result. `category` is the category the RESULTS carry (not the alias the caller typed), `state` the
// practice state where the caller gave one.
export function categoryPointer(category, state) {
  const slug = CATEGORY_SLUGS.get(categoryName(category));
  if (!slug) return null;
  const st = typeof state === 'string' ? state.trim().toLowerCase() : '';
  const sg = STATE_GUIDES[slug];
  if (sg && /^[a-z]{2}$/.test(st) && sg.states.split(',').includes(st)) return pointer(`${sg.prefix}${st}/`, sg.what(STATE_NAMES[st]));
  const g = CATEGORY_GUIDES[slug];
  if (g) return pointer(g.path, g.what);
  return pointer(`/providers/${slug}/`, `The ${category} companies in the directory, which you can narrow by state and city.`);
}

// One provider, from its own stored record. Mirrors the site's canonical-address rule; no record fields, no pointer.
export function providerPointer(p) {
  if (!p || typeof p.slug !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(p.slug)) return null;
  const cat = CATEGORY_SLUGS.get(categoryName(p.category));
  if (!cat) return null;
  const st = typeof p.state_abbr === 'string' && /^[A-Za-z]{2}$/.test(p.state_abbr) ? p.state_abbr.toLowerCase() : 'us';
  const city = typeof p.city_slug === 'string' && /^[a-z0-9-]+$/.test(p.city_slug) ? p.city_slug : 'national';
  return pointer(`/providers/${cat}/${st}/${city}/${p.slug}/`, "This company's profile page, with its services, where it is based and where each fact on the page came from.");
}

export function ehrProductPointer(productKey) {
  const row = Object.hasOwn(EHR_PRODUCTS, productKey) ? EHR_PRODUCTS[productKey] : null;
  if (!row) return null;
  const page = EHR_PAGES[row[1]];
  return pointer(page.path, page.what(row[0]));
}

export function categoriesPointer() {
  return pointer('/providers/', 'The directory index, listing every category with the companies in each.');
}

export function dataPointer(state, segment) {
  const st = typeof state === 'string' ? state.trim().toLowerCase() : '';
  const hit = st && typeof segment === 'string' && Object.hasOwn(COVERAGE, st) && COVERAGE[st].split(',').includes(segment);
  if (hit) return pointer(`/data/coverage/${st}/${segment}/`, `How many ${SEGMENT_NAMES[segment]} practices the dataset holds in ${st.toUpperCase()}, with what each record covers.`);
  return pointer('/data/', 'What the practice location dataset covers and how its credits work.');
}

// Fixed (non-provider) addresses the code can emit, for the build-time 200 check and the table test.
export function allFixedPaths() {
  const out = new Set(['/providers/', '/data/']);
  for (const slug of CATEGORY_SLUGS.values()) out.add(`/providers/${slug}/`);
  for (const g of Object.values(CATEGORY_GUIDES)) out.add(g.path);
  for (const g of Object.values(STATE_GUIDES)) for (const s of g.states.split(',')) out.add(`${g.prefix}${s}/`);
  for (const p of Object.values(EHR_PAGES)) out.add(p.path);
  for (const [st, segs] of Object.entries(COVERAGE)) for (const s of segs.split(',')) out.add(`/data/coverage/${st}/${s}/`);
  return [...out].sort();
}

// Derive the pointer for a finished tool result. `hint` is what the producer saw (kept off the wire).
export function pointerFor(name, args, result) {
  if (!result || result.isError || !Array.isArray(result.content)) return null;
  const h = result.pageHint || {};
  const a = args && typeof args === 'object' ? args : {};
  switch (name) {
    case 'match_practice':
    case 'search_providers': return h.category ? categoryPointer(h.category, a.state) : null;
    case 'get_provider_detail': return providerPointer(h.provider);
    case 'list_categories': return categoriesPointer();
    case 'get_ehr_product_detail': return ehrProductPointer(a.product_key);
    case 'practice_data_counts': return dataPointer(a.state, a.segment);
    default: return null;
  }
}

export function hintResult(result, hint) {
  Object.defineProperty(result, 'pageHint', { value: hint, enumerable: false });
  return result;
}

export function withPagePointer(name, args, result) {
  const p = pointerFor(name, args, result);
  return p ? { ...result, page_pointer: p } : result;
}
