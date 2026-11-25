// A server error's message made fit for the log (http/errors.ts onError): anything that could be
// personal or secret becomes `…` (a whole address, since an add-on's path is its key; an email; a
// quoted string over 40 characters; a run of 24 or more hex or base64 characters), whitespace is
// collapsed and the result is at most 300 characters. Pure: no request, no time.

export const MESSAGE_MAX = 300;
const CUT = '…';

const ADDRESS = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>]*/gi;
const EMAIL = /[^\s@"'`<>()[\]]+@[^\s@"'`<>()[\]]+\.[a-z]{2,}/gi;
const QUOTED = /"[^"]{41,}"|'[^']{41,}'|`[^`]{41,}`/g;
const RUN = /[A-Za-z0-9+/_=-]{24,}/g;

/** A long run is a key, a hash or a token when it has a digit or both cases (an all-letter word in
 * one case, such as SQLITE_CONSTRAINT_PRIMARYKEY, is kept). */
const secretRun = (run: string): boolean => /\d/.test(run) || (/[a-z]/.test(run) && /[A-Z]/.test(run));

export function scrubMessage(message: unknown): string {
  const text = String(message ?? '')
    .replace(ADDRESS, CUT)
    .replace(EMAIL, CUT)
    .replace(QUOTED, CUT)
    .replace(RUN, (run) => (secretRun(run) ? CUT : run))
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > MESSAGE_MAX ? `${text.slice(0, MESSAGE_MAX - 1)}${CUT}` : text;
}
