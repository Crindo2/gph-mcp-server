// C2455: plain-sentence errors for bad input, so an assistant that sends a wrong argument is told
// what was wrong and what to send instead, rather than getting an empty result with no reason.
//
// Every sentence here is a closed string written in this file. The only caller value echoed back is
// the argument the caller itself sent, and only when it is short plain text (echo() below), so no
// session, trace or account data can reach a reply (D514). Nothing here normalizes or rewrites a
// forwarded argument: a value is either accepted unchanged or the call is refused before it runs.

export const US_STATES = Object.freeze({
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
});
const NAME_TO_CODE = Object.freeze(Object.fromEntries(Object.entries(US_STATES).map(([c, n]) => [n.toLowerCase(), c])));

// The caller's own value, quoted back only when it is short plain text; otherwise null and the
// sentence says "that value".
export function echo(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim();
  return /^[A-Za-z0-9 .,'&()/_-]{1,48}$/.test(s) ? s : null;
}

export const isUsStateCode = v => typeof v === 'string' && Object.hasOwn(US_STATES, v);

// One sentence explaining why `value` is not a usable state, or null when it is fine.
// capitalsOnly: the tool's schema requires the capital code (practice_data_counts).
// usHint: what to do instead when the caller sent "US" (differs by tool).
// allowNames: a full state name (Texas) passes unchanged. match_practice and search_providers
// forwarded names before C2455 and the upstream resolver is not visible here, so they keep doing so.
export function stateProblem(value, { capitalsOnly = false, usHint, allowNames = false } = {}) {
  if (typeof value !== 'string') {
    return 'The state has to be sent as text, a two-letter code such as TX.';
  }
  const code = value.trim();
  const upper = code.toUpperCase();
  if (/^[A-Za-z]{2}$/.test(code)) {
    if (isUsStateCode(upper)) {
      return capitalsOnly && code !== upper ? `This tool needs the state code in capitals, so send ${upper} rather than ${code}.` : null;
    }
    if (upper === 'US') {
      return `US is the whole country rather than a state. ${usHint || 'Leave state out to cover every state, or send one state code such as TX.'}`;
    }
    return `${code} is not a US state code. Send one of the 50 state codes or DC, such as TX.`;
  }
  const named = NAME_TO_CODE[code.toLowerCase()];
  if (named && allowNames) return null;
  if (named) return `${code} is a state name, and this tool takes the two-letter code, so send ${named} instead.`;
  const shown = echo(code);
  return shown ? `${shown} is not a US state. Use a two-letter state code such as TX.` : 'That value is not a US state. Use a two-letter state code such as TX.';
}

// Append one plain sentence to a tool result as its own text block, leaving content[0] (the JSON
// body on the two JSON tools) byte-identical.
export function withNote(result, sentence) {
  if (!sentence) return result;
  return { ...result, content: [...result.content, { type: 'text', text: sentence }] };
}

// Join a list the way a person says it: "a", "a and b", "a, b and c".
export function andList(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
