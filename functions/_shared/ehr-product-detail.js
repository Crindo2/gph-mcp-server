import { echo, sentenceFirst } from './input-errors.js';
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
// C2455: each refusal keeps its JSON body in content[0] unchanged and adds one plain sentence
// saying what was wrong and what to send instead.
// No tool lists product keys, so the sentence says so and points at the nearest thing that helps.
const FIND_EHR = 'No tool here lists the keys, so if you need EHR vendors rather than one known product, call search_providers with the category Healthcare IT & EHR.';
const keyNote = (k) => {
  const shown = echo(k);
  if (typeof k !== 'string' || k.trim() === '') return `get_ehr_product_detail needs a product_key, the exact key of one EHR product written in lowercase with hyphens. ${FIND_EHR}`;
  return `${shown ? shown : 'That value'} is not a product key, because keys use only lowercase letters, numbers and hyphens and aliases aren't accepted. ${FIND_EHR}`;
};
export function validateEhrProductArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return sentenceFirst(notFound(), `get_ehr_product_detail needs its arguments as an object with a product_key. ${FIND_EHR}`);
  }
  if (typeof args.product_key !== 'string' || !/^[a-z0-9-]+$/.test(args.product_key)) return sentenceFirst(notFound(), keyNote(args.product_key));
  if (Object.hasOwn(args, 'edition_key') && (typeof args.edition_key !== 'string' || !/^[a-z0-9-]+$/.test(args.edition_key))) {
    return sentenceFirst(notFound(), 'edition_key has to be an exact edition key in lowercase letters, numbers and hyphens, so leave it out to get the product with all its recorded editions.');
  }
  const extra = Object.keys(args).filter(k => !['product_key', 'edition_key'].includes(k));
  if (extra.length) {
    const shown = echo(extra[0]);
    return sentenceFirst(frame({ error: 'invalid_arguments' }, true), `${shown ? shown : 'That argument'} is not a parameter of get_ehr_product_detail, which takes product_key and an optional edition_key.`);
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
    const body = await response.json();
    if (response.status === 404) return sentenceFirst(frame(body, true), `No EHR product has the key ${echo(args.product_key) || 'you sent'}. Keys must match exactly and aliases aren't accepted. ${FIND_EHR}`);
    if (args.edition_key !== undefined && !body.product?.editions?.some(e =>
      e.product_key === args.product_key && e.edition_key === args.edition_key)) {
      return sentenceFirst(notFound(), `${echo(args.product_key) || 'This product'} has no edition with the key ${echo(args.edition_key) || 'you sent'}, so leave edition_key out to get the product with all its recorded editions.`);
    }
    return frame(body);
  } catch {
    return frame({ error: 'product_upstream_unavailable' }, true);
  }
}
