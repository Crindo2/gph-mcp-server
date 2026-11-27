import { echo, stateProblem, withNote, sentenceFirst } from './input-errors.js';
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
// C2455: every refusal keeps {"error":"invalid_arguments"} in content[0] and adds one plain
// sentence. A two-letter code that is not a state (such as US) is now refused too; before, it
// matched the pattern and came back as an empty count with no reason given.
const SEGMENT_TEXT = 'primary-care, dental, pt-ot-speech, specialty-clinics, behavioral-health or derm-peds-vision-podiatry';
const invalid = sentence => sentenceFirst(frame({ error: 'invalid_arguments' }, true), sentence);
export function validatePracticeDataCountsArgs(args) {
  const a = args === undefined || args === null ? {} : args;
  if (typeof a !== 'object' || Array.isArray(a)) {
    return invalid('practice_data_counts takes its arguments as an object with an optional state and segment, or no arguments at all for every state.');
  }
  const extra = Object.keys(a).find(k => !['state', 'segment'].includes(k));
  if (extra !== undefined) {
    return invalid(`${echo(extra) || 'That argument'} is not a parameter of practice_data_counts, which takes only state and segment.`);
  }
  if (Object.hasOwn(a, 'state')) {
    const problem = stateProblem(a.state, { capitalsOnly: true, usHint: 'Leave state out to get counts for every state, or send one state code such as TX.' });
    if (problem) return invalid(problem);
    if (!/^[A-Z]{2}$/.test(a.state)) return invalid('The state has to be the two-letter capital code with nothing around it, such as TX.');
  }
  if (Object.hasOwn(a, 'segment') && (typeof a.segment !== 'string' || !PRACTICE_DATA_SEGMENTS.includes(a.segment))) {
    const shown = echo(a.segment);
    return invalid(`${shown ? `${shown} is not` : 'That value is not'} one of the practice segments. Send ${SEGMENT_TEXT}, or leave segment out for all of them.`);
  }
  return null;
}

// C2455 s.2: a valid query that matches no published cell still returns the body unchanged, plus
// one sentence on how to widen it.
function emptyNote(a) {
  if (a.state !== undefined && a.segment !== undefined) {
    return `No published counts matched ${a.segment} in ${a.state}. Cells with fewer than 25 practices are withheld, so try leaving out segment, or state, for a wider total.`;
  }
  if (a.state !== undefined) return `No published counts matched ${a.state}. Cells with fewer than 25 practices are withheld, so leave state out to see every state.`;
  if (a.segment !== undefined) return `No published counts matched ${a.segment}. Cells with fewer than 25 practices are withheld, so leave segment out to see all segments.`;
  // No filter sent: there is nothing to widen, and the reply stays as it was on main (c1994 golden).
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
    const count = publishedCellCount(body);
    const result = frame(body, false, count);
    return count === 0 ? withNote(result, emptyNote(a)) : result;
  } catch {
    return frame({ error: 'practice_data_counts_upstream_unavailable' }, true);
  }
}
