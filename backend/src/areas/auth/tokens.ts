// Bearer tokens (SECURITY.md §5.1): a prefix naming the principal, 43 base62 random characters
// (256 bits) and 6 base62 characters of CRC32 over prefix and body. The checksum lets the Worker
// refuse garbage before any object call, and lets secret scanners recognise a real token.
import { randomBytes } from 'node:crypto';
import type { AgentRole } from '../../../../shared/contract/api';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export type TokenPrefix = 'th1' | 'thm' | 'ths' | 'thc';

export const TOKEN_RE = /^(th1|thm|ths|thc)_([0-9A-Za-z]{43})([0-9A-Za-z]{6})$/;

/** Uniform base62: bytes ≥ 248 are dropped so every character is equally likely. */
export function base62(length: number): string {
  let out = '';
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      if (b < 248 && out.length < length) out += BASE62[b % 62];
    }
  }
  return out;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(text: string): number {
  let c = 0xffffffff;
  for (const b of new TextEncoder().encode(text)) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function checksum(head: string): string {
  let n = crc32(head);
  let out = '';
  for (let i = 0; i < 6; i++) {
    out = BASE62[n % 62] + out;
    n = Math.floor(n / 62);
  }
  return out;
}

export function newToken(prefix: TokenPrefix): string {
  const head = `${prefix}_${base62(43)}`;
  return head + checksum(head);
}

export function prefixForRole(role: AgentRole): TokenPrefix {
  if (role === 'muse') return 'ths';
  if (role === 'ci') return 'thc';
  return 'thm';
}

/** The prefix of a well-formed token whose checksum matches, else null. No I/O. */
export function checkToken(token: string): TokenPrefix | null {
  const m = TOKEN_RE.exec(token);
  if (!m) return null;
  return checksum(`${m[1]}_${m[2]}`) === m[3] ? (m[1] as TokenPrefix) : null;
}

/** A 30-second live ticket (P2): `thw_` + 22 base62, 128 bits, stored only as SHA-256. */
export function newLiveTicket(): string {
  return `thw_${base62(22)}`;
}
