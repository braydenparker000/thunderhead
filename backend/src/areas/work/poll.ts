// Muse's poll held to its period (MUSE-PROTOCOL.md §2, owner 2026-11-21: every 5 minutes). Each
// empty claim answers `204` with `Retry-After: 300`, and this isolate remembers, per agent, when it
// last answered one: a claim within 5 minutes of it answers `204` with the seconds left, without
// calling Core. An order placed meanwhile is taken at the first claim after the wait.
export const POLL_S = 300;
const POLL_MS = POLL_S * 1_000;
const LIMIT = 64;
const lastEmpty = new Map<string, number>();

/** Seconds this agent should still wait (0: ask Core). */
export function waitLeft(agent: string, now: number): number {
  const at = lastEmpty.get(agent);
  if (at === undefined || now - at >= POLL_MS || now < at) return 0;
  return Math.max(1, Math.ceil((at + POLL_MS - now) / 1_000));
}

/** Core had nothing for this agent at `now`. */
export function answeredEmpty(agent: string, now: number): void {
  if (lastEmpty.size >= LIMIT) lastEmpty.clear();
  lastEmpty.set(agent, now);
}

/** Core handed this agent an order: its next claim asks Core again. */
export function answeredOrder(agent: string): void {
  lastEmpty.delete(agent);
}

/** Tests: forget every agent's last empty answer in this isolate. */
export function forgetPolls(): void {
  lastEmpty.clear();
}
