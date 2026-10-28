// @ts-check
// Setup, reset and recovery codes (SIGN-IN.md §1, §7.1): 25 Crockford base32 characters
// (125 bits). Setup and reset codes are made here in the browser; only their fingerprint leaves
// it until the one request that uses them. Mirrors backend/src/areas/auth/crypto.ts.

export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** @param {(n: number) => Uint8Array} [random] */
export function makeCode(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  return Array.from(random(25), (b) => CROCKFORD[b & 31]).join('');
}

/** Folds case, hyphens, spaces and look-alikes (O→0, I/L→1). Null when it cannot be a code.
 * @param {string} input */
export function normalizeCode(input) {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{25}$/.test(s) ? s : null;
}

/** Five groups of five, e.g. `7KQ2M-XW4TR-9DHPA-3NB6E-QY8VC`. @param {string} code */
export function groupCode(code) {
  const s = normalizeCode(code) ?? code;
  return (s.match(/.{1,5}/g) ?? [s]).join('-');
}

/** The last five characters of a code, folded the same way. @param {string} code */
export function lastFive(code) {
  return (normalizeCode(code) ?? code.toUpperCase().replace(/[\s-]/g, '')).slice(-5);
}

/** Whether a typed confirmation matches the code's last five. @param {string} code @param {string} typed */
export function confirmsLastFive(code, typed) {
  const t = typed.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return t.length === 5 && t === lastFive(code);
}

/** `thfp_` + base64url(SHA-256(code)): 48 characters, safe to paste anywhere. @param {string} code */
export async function fingerprint(code) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code)));
  const b64 = btoa(String.fromCharCode(...digest));
  return `thfp_${b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}
