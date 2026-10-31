// @ts-check
// Words from the browser or the player, made safe to send to the Worker (API.md §11.16): an address
// keeps only its host (any scheme, HTTPS:// or blob:https:// or file:// or content://, a user and
// password dropped, the whole path dropped even where it holds spaces, percent-encoded ones too),
// quoted text and a `/pattern/` become `…` (browsers quote what was typed: `"<text>" cannot be parsed
// as a URL`, `Unexpected identifier "<word>"`), a session or key token goes. The phone's copy of
// `cleanText` in shared/contract/reports-clean.ts; tests/music-report.test.mjs checks the two agree.
// Used by the shell's error reports (ui/error-items.js) and Music's playback batches
// (th/music/report-fields.js).

// An address: any scheme (a word and a colon that no space or colon follows), any user and password,
// and the rest of the text up to a quote or a bracket. Only its host stays.
const ADDRESS = /\b((?:[a-z][a-z0-9+.-]*:(?=[^\s:]))+)(?:\/\/(?:[^\s/?#@"'<>()[\]]*@)?([^\s/?#@"'<>()[\]]*))?[^"'<>()[\]]*/gi;
const QUOTED = [/(?<![A-Za-z0-9])"[^"\n]*"/g, /(?<![A-Za-z0-9])'[^'\n]*'(?![A-Za-z0-9])/g, /“[^”\n]*”|‘[^’\n]*’|`[^`\n]*`/g];
const PATTERN = /(^|[\s:(])\/(?:\\.|[^/\s\\])(?:\\.|[^/\n\\])*\/[dgimsuvy]*(?=$|[\s:,.)])/g;
const TOKEN = /\b(th1|thm|ths|thc|thw|thfp)_[A-Za-z0-9_-]{8,}/g;

/** Words as sent, at most `max` characters. @param {string} s @param {number} max */
export function cleanText(s, max) {
  let out = s.replace(/%([0-9a-f]{2})/gi, (_m, h) => String.fromCharCode(Number.parseInt(h, 16)));
  out = out.replace(ADDRESS, (m, scheme, host) => (host ? `${host}/…` : `${scheme.split(':')[0]}:…`) + (/\s$/.test(m) ? ' ' : ''));
  for (const q of QUOTED) out = out.replace(q, '…');
  return out.replace(PATTERN, '$1…').replace(TOKEN, '[token]').slice(0, max);
}
