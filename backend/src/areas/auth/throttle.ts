// Back-off numbers of SIGN-IN.md §6.1. No lockout: a stranger can make the owner wait at most
// 30 s for sign-in and 5 min for a code, never a day (decisions 2026-10-28). Pure functions;
// the counters live in store.ts under the key `<kind>:<source hash>`, `<kind>:acct` or
// `pwcheck:<session id>` (DATA.md §5).
import { DAY, HOUR, MINUTE, SECOND } from '../../lib/time';

export interface Counter {
  fails: number;
  window_start: number;
  last_at: number;
  next_allowed_at: number;
}

/** What is being guessed. `reset` counts reset tickets requested through the mind. */
export type Kind = 'signin' | 'recover' | 'setup' | 'reset' | 'pwcheck';

/** One counter: its kind and whose it is (a source hash, `acct`, or a session id). */
export type CounterRef = [kind: Kind, who: string];

interface Rule {
  /** The counter starts over this long after its first failure. */
  windowMs?: number;
  /** The counter starts over after this much quiet since the last failure. */
  quietMs?: number;
  /** Wait imposed after the n-th failure, in ms from now. */
  delay(fails: number, c: Counter, now: number): number;
}

const doubling = (free: number, cap: number) => (n: number) =>
  n <= free ? 0 : Math.min(2 ** (n - free) * SECOND, cap);

/** Per source at sign-in: 5 free tries, then 2, 4, 8 … s up to 15 min; forgotten after 24 h quiet. */
const SIGNIN_SRC: Rule = { quietMs: DAY, delay: doubling(5, 15 * MINUTE) };
/** All sources together: after 20 failures in 24 h, one attempt per 30 s, never longer. */
const SIGNIN_ACCT: Rule = { windowMs: DAY, delay: (n) => (n < 20 ? 0 : 30 * SECOND) };
/** Recovery, reset and setup codes per source: 5 per hour, then wait for the hour to end. */
const CODE_SRC: Rule = { windowMs: HOUR, delay: (n, c, now) => (n < 5 ? 0 : c.window_start + HOUR - now) };
/** Codes account-wide: after failure n ≥ 20 in 24 h, min(30 s × 2^(n−20), 5 min). */
const CODE_ACCT: Rule = {
  windowMs: DAY,
  delay: (n) => (n < 20 ? 0 : Math.min(30 * SECOND * 2 ** (n - 20), 5 * MINUTE)),
};
/** Mind-requested reset tickets: 3 in 30 days, then wait for the window to end. */
const RESET_ACCT: Rule = { windowMs: 30 * DAY, delay: (n, c, now) => (n < 3 ? 0 : c.window_start + 30 * DAY - now) };
/** The password check inside Settings: 5 per session, then 2^(n−5) s up to 15 min. */
const PWCHECK: Rule = { quietMs: DAY, delay: doubling(5, 15 * MINUTE) };

export function ruleFor(kind: Kind, who: string): Rule {
  const acct = who === 'acct';
  switch (kind) {
    case 'signin':
      return acct ? SIGNIN_ACCT : SIGNIN_SRC;
    case 'reset':
      return acct ? RESET_ACCT : CODE_SRC;
    case 'pwcheck':
      return PWCHECK;
    default:
      return acct ? CODE_ACCT : CODE_SRC;
  }
}

function stale(c: Counter, now: number, rule: Rule): boolean {
  if (rule.windowMs !== undefined && now - c.window_start >= rule.windowMs) return true;
  if (rule.quietMs !== undefined && now - c.last_at >= rule.quietMs) return true;
  return false;
}

/** How long (ms) the next attempt must wait; 0 when it may go ahead. */
export function waitMs(c: Counter | null, now: number, kind: Kind, who: string): number {
  const rule = ruleFor(kind, who);
  if (!c || stale(c, now, rule)) return 0;
  return Math.max(0, c.next_allowed_at - now);
}

/** The counter after one more failure. */
export function afterFailure(c: Counter | null, now: number, kind: Kind, who: string): Counter {
  const rule = ruleFor(kind, who);
  const base = c && !stale(c, now, rule) ? c : { fails: 0, window_start: now, last_at: now, next_allowed_at: 0 };
  const next: Counter = { ...base, fails: base.fails + 1, last_at: now };
  next.next_allowed_at = now + Math.max(0, rule.delay(next.fails, next, now));
  return next;
}

/** Whole seconds for `retry_after` and `Retry-After`, never 0. */
export function retryAfterSeconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / SECOND));
}
