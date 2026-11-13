// C1569 s.5: every successful tool response carries a citation: `source` and a `url` to the
// matching public page, tagged so click-throughs from AI answers show in our own analytics.
// The tool's own content[0] (including the practice_data_counts JSON body) is never altered;
// the citation rides as top-level fields plus one trailing text block. C1994 s.3: that block starts with a
// blank line, so the Source line sits on its own line after a blank line when a client joins the text blocks
// (otherwise it ran into the last address of the reply: "...<session id>Source: GetPracticeHelp").
const SITE = 'https://www.getpracticehelp.com';
const DATA_SOURCE = 'GetPracticeHelp Practice Data';
const DIRECTORY_SOURCE = 'GetPracticeHelp';

const tag = (url, tool) => {
  const u = new URL(url);
  u.searchParams.set('utm_source', 'mcp');
  u.searchParams.set('utm_medium', 'ai-assistant');
  u.searchParams.set('utm_campaign', tool);
  return u.toString();
};

// Page choice uses only what the code already knows: provider slug, otherwise the nearest hub.
export function attributionFor(name, args) {
  const a = args && typeof args === 'object' ? args : {};
  if (name === 'practice_data_counts') return { source: DATA_SOURCE, url: tag(`${SITE}/data/`, name) };
  if (name === 'get_provider_detail' && typeof a.slug === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(a.slug)) {
    return { source: DIRECTORY_SOURCE, url: tag(`${SITE}/providers/${a.slug}/`, name) };
  }
  if (name === 'match_practice') return { source: DIRECTORY_SOURCE, url: tag(`${SITE}/match/`, name) };
  return { source: DIRECTORY_SOURCE, url: tag(`${SITE}/providers/`, name) };
}

export function withAttribution(name, args, result) {
  if (!result || result.isError || !Array.isArray(result.content)) return result;
  const { source, url } = attributionFor(name, args);
  return { ...result, content: [...result.content, { type: 'text', text: `\n\nSource: ${source} ${url}` }], source, url };
}
