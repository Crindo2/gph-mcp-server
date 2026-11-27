// C2455: the only change C2455 makes to a golden reply is one added plain-sentence text block,
// placed just before the Source block (or at the end of a reply that has none). Every other byte,
// content[0] included, stays as it was. This lists exactly which golden replies gain a block and
// the sentence each one gains, so the older golden tests keep asserting everything else unchanged.
export const C1994_NOTES = Object.freeze({
  'match_practice/no_results': 'Nothing matched in that location, so try again with vendor_geo_preference set to NATIONAL_OK to let national vendors in.',
  'search_providers/search_empty': 'No providers are listed under Medical Billing right now, so call list_categories and try a related category.',
  'search_providers/search_empty/serveTool': 'No providers are listed under Medical Billing right now, so call list_categories and try a related category.',
  'get_provider_detail/provider_missing': 'No provider has the slug nope. Slugs come from match_practice or search_providers results, so run one of those and pass a slug it returns.',
  'practice_data_counts/counts_state': 'No published counts matched TX. Cells with fewer than 25 practices are withheld, so leave state out to see every state.',
});

export const C1984_NOTES = Object.freeze({
  no_results: C1994_NOTES['match_practice/no_results'],
});

// Insert the C2455 sentence into a golden reply in place (mutates and returns it).
export function addC2455Note(reply, sentence) {
  if (!sentence || !reply || !Array.isArray(reply.content)) return reply;
  const block = { type: 'text', text: sentence };
  const last = reply.content.at(-1);
  if (last && /^(\n\n)?Source: /.test(last.text)) reply.content.splice(reply.content.length - 1, 0, block);
  else reply.content.push(block);
  return reply;
}
