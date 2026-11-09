export const PRACTICE_DATA_SEGMENTS = Object.freeze(['primary-care', 'dental', 'pt-ot-speech', 'specialty-clinics', 'behavioral-health', 'derm-peds-vision-podiatry']);
// C1471 s.4.2: aggregate practice counts by US state and segment. Reads the public JSON endpoint only.
export const PRACTICE_DATA_COUNTS_TOOL = {
  name: 'practice_data_counts',
  title: 'Practice Data Counts',
  description: 'Counts practices with headline (strongest-tier) evidence only, by US state and practice segment, from the public Practice Data aggregate endpoint (unit: practices (headline evidence)). It excludes lower-evidence records, so these numbers are lower than the all-record totals on the Practice Data product pages (507,423 nationally as published there). Cells with fewer than 25 practices are not published (returned with count null and suppressed true). Aggregate counts only: no records or names are returned. Optional state and segment filters narrow the result; the JSON body is returned unchanged.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true, destructiveHint: false },
  inputSchema: {
    type: 'object',
    properties: {
      state: { type: 'string', pattern: '^[A-Z]{2}$', description: 'Optional two-letter capital US state code, e.g. TX.' },
      segment: { type: 'string', enum: [...PRACTICE_DATA_SEGMENTS], description: 'Optional practice segment slug, one of the six served by the endpoint, e.g. primary-care.' },
    },
    additionalProperties: false,
  },
};

const frame = (body, isError = false, count) => ({ content: [{ type: 'text', text: JSON.stringify(body) }], ...(isError ? { isError: true } : {}), ...(count === undefined ? {} : { count }) });
// C1569 s.1: telemetry reads result.count. Report the published, non-suppressed cells returned.
export function publishedCellCount(body) {
  let n = 0;
  for (const st of Array.isArray(body && body.states) ? body.states : []) {
    for (const c of Array.isArray(st && st.segments) ? st.segments : []) {
      if (c && c.suppressed !== true && typeof c.count === 'number') n += 1;
    }
  }
  return n;
}
export function validatePracticeDataCountsArgs(args) {
  const a = args === undefined || args === null ? {} : args;
  if (typeof a !== 'object' || Array.isArray(a) ||
      Object.keys(a).some(k => !['state', 'segment'].includes(k)) ||
      (Object.hasOwn(a, 'state') && (typeof a.state !== 'string' || !/^[A-Z]{2}$/.test(a.state))) ||
      (Object.hasOwn(a, 'segment') && (typeof a.segment !== 'string' || !PRACTICE_DATA_SEGMENTS.includes(a.segment)))) {
    return frame({ error: 'invalid_arguments' }, true);
  }
  return null;
}

export async function practiceDataCounts(args) {
  const invalid = validatePracticeDataCountsArgs(args);
  if (invalid) return invalid;
  const a = args || {};
  const qs = new URLSearchParams();
  if (a.state !== undefined) qs.set('state', a.state);
  if (a.segment !== undefined) qs.set('segment', a.segment);
  const q = qs.toString();
  try {
    const response = await fetch(`https://www.getpracticehelp.com/data/api/counts${q ? `?${q}` : ''}`, {
      method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10000),
    });
    if (response.status !== 200) return frame({ error: 'practice_data_counts_upstream_error', status: response.status }, true);
    const body = await response.json();
    return frame(body, false, publishedCellCount(body));
  } catch {
    return frame({ error: 'practice_data_counts_upstream_unavailable' }, true);
  }
}
