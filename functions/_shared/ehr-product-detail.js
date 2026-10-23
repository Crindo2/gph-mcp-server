import { publicToolData } from './monetization-boundary.js';

// C840 s.2 / E8 section 4: read the P1 projection, without a second factual store.
export const EHR_PRODUCT_TOOL = {
  name: 'get_ehr_product_detail',
  title: 'Get EHR Product Detail',
  description: 'Read the free versioned EHR product JSON projection by exact product key. Returns the complete HTTP JSON body, including explicit edition records, facts, plans, conditions, sources and publication metadata. Optional edition_key validates an explicit identity under this product; the full product response is returned unchanged. No alias resolution, edition inheritance, calculation or ranking. Unknown values and open bounds remain unchanged. Company profiles use get_provider_detail.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true, destructiveHint: false },
  inputSchema: {
    type: 'object',
    properties: {
      product_key: { type: 'string', pattern: '^[a-z0-9-]+$', description: 'Exact P1 product key; aliases are not accepted.' },
      edition_key: { type: 'string', pattern: '^[a-z0-9-]+$', description: 'Optional exact edition key explicitly recorded under this product. Does not filter or merge facts.' },
    },
    required: ['product_key'],
    additionalProperties: false,
  },
};

const frame = (body, isError = false) => ({ content: [{ type: 'text', text: JSON.stringify(body) }], ...(isError ? { isError: true } : {}) });
const notFound = () => frame({ schema_version: '1.0.0', error: 'product_not_found' }, true);
export function validateEhrProductArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
      typeof args.product_key !== 'string' || !/^[a-z0-9-]+$/.test(args.product_key) ||
      (Object.hasOwn(args, 'edition_key') && (typeof args.edition_key !== 'string' || !/^[a-z0-9-]+$/.test(args.edition_key)))) return notFound();
  if (Object.keys(args).some(k => !['product_key', 'edition_key'].includes(k))) {
    return frame({ error: 'invalid_arguments' }, true);
  }
  return null;
}

export async function ehrProductDetail(args) {
  const invalid = validateEhrProductArgs(args);
  if (invalid) return invalid;
  try {
    // Fixed public origin, GET only, no credentials, finite wait including body read.
    const response = await fetch(`https://www.getpracticehelp.com/api/ehr/products/${args.product_key}`, {
      method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10000),
    });
    if (response.status >= 300 && response.status < 400) return frame({ error: 'product_upstream_error' }, true);
    if (!response.ok && response.status !== 404) return frame({ error: 'product_upstream_error' }, true);
    const body = publicToolData(await response.json());
    if (response.status === 404) return frame(body, true);
    if (args.edition_key !== undefined && !body.product?.editions?.some(e =>
      e.product_key === args.product_key && e.edition_key === args.edition_key)) return notFound();
    return frame(body);
  } catch {
    return frame({ error: 'product_upstream_unavailable' }, true);
  }
}
