// The reset time in a usage-limit error (RUNTIME.md §6.3, §9 F4): the StopFailure hook passes it to
// `th status limited --until <ms>`, so the chat can say when the mind answers. The platform's text
// is not a contract, so this reads the forms seen so far and gives up quietly on anything else:
// an epoch after a bar (`…limit reached|1767225600`), an ISO time with its offset, or a clock time
// with its zone (`resets 3pm (Europe/Lisbon)`, `resets at 15:40 (UTC)`). Only a time in the next 7
// days counts.
const WEEK_MS = 7 * 86_400_000;

/** The zone's offset from UTC at `at`, in ms (local wall clock minus the instant). */
function offset(at, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric',
    day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'}).formatToParts(at).map(p => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - Math.floor(at / 1000) * 1000;
}

/** The next time the wall clock in `tz` reads h:m, after `now`. */
function nextClock(h, m, tz, now) {
  const local = new Date(now + offset(now, tz));
  for (let k = 0; k < 2; k++) {
    const wall = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + k, h, m);
    const at = wall - offset(wall - offset(wall, tz), tz);
    if (at > now) return at;
  }
  return null;
}

/** @param {unknown} text @param {number} [now] @returns {number | null} epoch ms */
export function resetAt(text, now = Date.now()) {
  if (typeof text !== 'string' || !text) return null;
  const ok = at => (Number.isFinite(at) && at > now && at <= now + WEEK_MS ? at : null);
  const epoch = /\|(\d{10})\b/.exec(text);
  if (epoch) return ok(Number(epoch[1]) * 1000);
  const iso = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})/.exec(text);
  if (iso) return ok(Date.parse(iso[0]));
  const c = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*\(([A-Za-z_]+(?:\/[A-Za-z_+-]+)*)\)/i.exec(text);
  if (!c) return null;
  let h = Number(c[1]);
  const m = Number(c[2] ?? 0);
  if (c[3]) h = (h % 12) + (c[3].toLowerCase() === 'pm' ? 12 : 0);
  if (h > 23 || m > 59) return null;
  try { return ok(nextClock(h, m, c[4], now)); } catch { return null; }
}
