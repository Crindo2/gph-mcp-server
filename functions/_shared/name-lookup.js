// Vendor-name lookup rules shared by the GPH search API and the MCP search_providers tool
// (C710 s.2). This file is byte-identical in Crindo2/getpracticehelp and Crindo2/gph-mcp-server;
// tests/name-lookup.test.mjs in each repo pins the sha256 so the two copies cannot drift.
//
// SCOPE. The `name` argument matches ONLY the public vendor company_name (openly enumerable per
// the 2026-09-16 ruling). It never touches practice or patient fields. The submitted text is
// never retained: callers log matched slugs and the result count, never the name itself.

export const NAME_MAX_CHARS = 100;
export const NAME_RESULT_CAP = 25;

// Case-, accent- and punctuation-insensitive form: letters and digits only, lower-cased.
export function normalizeName(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

// Returns { ok: true, normalized } or { ok: false, error }. The error text never echoes the input.
export function checkNameArg(value) {
  if (typeof value !== 'string') return { ok: false, error: '`name` must be a string' };
  if ([...value].length > NAME_MAX_CHARS) return { ok: false, error: `\`name\` must be at most ${NAME_MAX_CHARS} characters` };
  // Email, phone and NPI shapes are refused, not searched: a vendor name never carries them.
  if (value.includes('@')) return { ok: false, error: '`name` looks like an email address; it takes a vendor company name only' };
  if ((value.match(/\p{Nd}/gu) || []).length >= 7) return { ok: false, error: '`name` looks like a phone number or NPI; it takes a vendor company name only' };
  const normalized = normalizeName(value);
  if (!normalized) return { ok: false, error: '`name` must contain at least one letter or digit' };
  return { ok: true, normalized };
}
