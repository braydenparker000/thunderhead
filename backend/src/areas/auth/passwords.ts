// Username and password rules (SIGN-IN.md §4.1 step 4, §9.2) and the Have I Been Pwned range
// check (PRIVACY.md §5): only the first 5 hex characters of the SHA-1 leave the Worker, with
// padding, and never at sign-in. The check is behind the AUTH_HIBP var; tests never call it.
import { createHash } from 'node:crypto';
import type { ErrorCode } from '../../../../shared/contract/api';

export const MIN_PASSWORD = 15;
export const MAX_PASSWORD = 128;
export const MAX_PASSWORD_BYTES = 1024;

/** Usernames compare after NFKC, trim and lower-casing. */
export function normalizeUsername(u: string): string {
  return u.normalize('NFKC').trim().toLowerCase();
}

export function usernameOk(normalized: string): boolean {
  return /^[a-z0-9._-]{3,32}$/.test(normalized);
}

/** Too long to hash at all (any form, sign-in included): 128 characters or 1,024 bytes. */
export function overCap(password: string): boolean {
  const p = password.normalize('NFKC');
  return [...p].length > MAX_PASSWORD || new TextEncoder().encode(p).length > MAX_PASSWORD_BYTES;
}

export type PasswordCode = Extract<
  ErrorCode,
  'password_too_short' | 'password_too_long' | 'password_guessable' | 'password_breached' | 'password_same'
>;

/** The first rule a new password breaks, without the breach check, or null. */
export function passwordProblem(password: string, username: string, current?: string): PasswordCode | null {
  const p = password.normalize('NFKC');
  if ([...p].length < MIN_PASSWORD) return 'password_too_short';
  if (overCap(p)) return 'password_too_long';
  const lower = p.toLowerCase();
  if ((username.length >= 3 && lower.includes(username)) || lower.includes('thunderhead')) return 'password_guessable';
  if (current !== undefined && current.normalize('NFKC') === p) return 'password_same';
  return null;
}

/** true = found in a breach; false = not found; null = the service did not answer in time
 * (the password is then accepted, SIGN-IN.md §9.2). */
export type BreachCheck = (password: string) => Promise<boolean | null>;

export const HIBP_RANGE = 'https://api.pwnedpasswords.com/range/';

export function hibpCheck(fetcher: typeof fetch, timeoutMs = 2000): BreachCheck {
  return async (password) => {
    const sha1 = createHash('sha1').update(password.normalize('NFKC')).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    try {
      const res = await fetcher(HIBP_RANGE + prefix, {
        headers: { 'Add-Padding': 'true' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return null;
      for (const line of (await res.text()).split('\n')) {
        const [s, count] = line.trim().split(':');
        // Padding rows have a count of 0.
        if (s === suffix) return Number(count) > 0;
      }
      return false;
    } catch {
      return null;
    }
  };
}

/** Used when AUTH_HIBP is off: nothing leaves the Worker. */
export const noBreachCheck: BreachCheck = async () => false;
