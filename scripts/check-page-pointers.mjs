// C2284 s.5: build-time check that every address the page pointers can emit answers 200.
// Usage: node scripts/check-page-pointers.mjs [--write]   (--write records the result in tests/fixtures/page-pointers-verified.json)
// Live network, so it is not part of the unit suite; tests/page-pointers.test.mjs reads the recorded result and
// fails if the mapping table has an address that was not in the last recorded all-200 run.
import { writeFileSync } from 'node:fs';
import { allFixedPaths, providerPointer, POINTER_MARKER_KEY, POINTER_MARKER_VALUE, CATEGORY_SLUGS } from '../functions/_shared/page-pointers.js';

const SITE = 'https://www.getpracticehelp.com';
const once = async (url) => {
  const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
  await r.arrayBuffer();
  return r.status;
};
// A 5xx is retried (up to 3 tries) because the site sometimes answers one transiently; a 404 or a redirect is final.
const get = async (url) => {
  let s = 0;
  for (let t = 0; t < 3; t++) { s = await once(url).catch(() => 0); if (s === 200 || (s >= 300 && s < 500)) return s; }
  return s;
};
const withMarker = (p) => `${SITE}${p}?${POINTER_MARKER_KEY}=${POINTER_MARKER_VALUE}`;

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

const paths = allFixedPaths();
const statuses = await pool(paths, 8, async (p) => ({ path: p, status: await get(withMarker(p)).catch(() => 0) }));

// Provider pages are built per record; sample the live directory across categories and check the built address.
const providerChecks = [];
for (const category of CATEGORY_SLUGS.keys()) {
  try {
    const res = await fetch(`${SITE}/api/search?category=${encodeURIComponent(category)}&per_page=1`, { signal: AbortSignal.timeout(20000) });
    const data = await res.json();
    const slug = data.providers?.[0]?.slug;
    if (!slug) continue;
    // The search row has no city_slug; the pointer is built from the full stored record, as the tool does.
    const p = (await (await fetch(`${SITE}/api/provider/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(20000) })).json()).provider;
    const ptr = providerPointer(p);
    if (!ptr) { providerChecks.push({ category, built: false, status: 0 }); continue; }
    providerChecks.push({ category, built: true, status: await get(ptr.url) });
  } catch { providerChecks.push({ category, built: false, status: 0 }); }
}

const bad = statuses.filter(s => s.status !== 200);
const badProviders = providerChecks.filter(s => s.built && s.status !== 200);
const result = {
  checked_on: new Date().toISOString().slice(0, 10),
  marker: `${POINTER_MARKER_KEY}=${POINTER_MARKER_VALUE}`,
  fixed_addresses_checked: statuses.length,
  fixed_addresses_200: statuses.length - bad.length,
  provider_samples_built: providerChecks.filter(s => s.built).length,
  provider_samples_200: providerChecks.filter(s => s.built && s.status === 200).length,
  failures: [...bad.map(b => `${b.path} ${b.status}`), ...badProviders.map(b => `provider sample ${b.category} ${b.status}`)],
  ok_paths: statuses.filter(s => s.status === 200).map(s => s.path),
};
console.log(JSON.stringify({ ...result, ok_paths: undefined }, null, 1));
if (process.argv.includes('--write')) writeFileSync(new URL('../tests/fixtures/page-pointers-verified.json', import.meta.url), JSON.stringify(result, null, 1) + '\n');
process.exit(result.failures.length ? 1 : 0);
