// Text made safe to paste into a chat or a report (docs/product/apps/ASTRA.md §5.2 rule 3): add-on and stream
// addresses carry keys and tokens, and a hash or a file name says what the owner watches. scrubSecrets() is the
// last line of defence for the lab's reports, which never put such things in to begin with: every address
// becomes its host and "/…" (or "[address]" with `hosts: false`), a key, token or password named in a query
// becomes ***, any run of 32 or more hex or base64url characters (a hash, a key, a token, an encoded add-on
// setting) becomes ***, a video or subtitle file's name becomes [file], and each of the `known` strings (the
// addresses and names the caller held) is removed wherever it appears, plain or percent-encoded.

const ADDRESS = /\b[a-z][a-z0-9+.-]*:\/\/(?:[^\s/?#@"'<>()[\]]*@)?([^\s/?#@"'<>()[\]:]*)(?::\d+)?[^\s"'<>()[\]]*/gi;
const QUERY = /([?&;](?:token|apikey|api_key|key|access_token|password|pass|secret)=)[^&\s#"'<>]*/gi;
const RUN = /[A-Za-z0-9_-]{32,}/g;
const FILE = /[^\s/\\"'<>|:*?]+\.(?:mkv|mp4|m4v|avi|webm|mov|ts|m2ts|mts|wmv|flv|mpg|mpeg|vob|iso|ogv|3gp|srt|ass|ssa|vtt|sub|idx)\b/gi;

/** `text` with every address, key, hash and file name taken out. @param {string} text @param {{known?: string[], hosts?: boolean}} [o] */
export function scrubSecrets(text, {known = [], hosts = true} = {}) {
  let out = String(text ?? '');
  for (const k of known) {
    if (typeof k !== 'string' || k.length < 4) continue;
    for (const form of new Set([k, encodeURIComponent(k), encodeURI(k)])) out = out.split(form).join('[removed]');
  }
  out = out.replace(QUERY, '$1***');
  out = out.replace(ADDRESS, (_m, host) => (hosts && host ? `${host}/…` : '[address]'));
  out = out.replace(RUN, '***');
  return out.replace(FILE, '[file]');
}

/**
 * The TorBox server group a file's host names: the label before "tb-cdn" (nexus-1.latm.tb-cdn.example → latm), and
 * nothing else of the host; '' for a host that is not TorBox's.
 */
export function serverGroup(url) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return ''; }
  const labels = host.split('.'), at = labels.indexOf('tb-cdn');
  return at > 0 && /^[a-z0-9-]{1,20}$/.test(labels[at - 1]) ? labels[at - 1] : '';
}
