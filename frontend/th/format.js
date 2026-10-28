// @ts-check
// Words for times, places and security notices on the device list, the agent list and Home
// (SIGN-IN.md §11.1, §11.4, §17). No DOM; `now` is passed in so tests pin the clock.

/** @typedef {import('../../shared/contract/api.ts').Notice} Notice */
/** @typedef {import('../../shared/contract/api.ts').SessionItem} SessionItem */
/** @typedef {import('../../shared/contract/api.ts').AgentRole} AgentRole */

const DAY = 86_400_000;

/** `14:05` @param {number} ms */
export const hhmm = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** `3 Oct` @param {number} ms */
export const dMMM = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** Start of the local day holding `ms`. @param {number} ms */
const dayStart = (ms) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** "active now" (this hour), "active today", "yesterday", "{N} days ago" (≤30), else "{d MMM}".
 * @param {number} ms @param {number} [now] */
export function lastActive(ms, now = Date.now()) {
  if (now - ms < 3_600_000) return 'active now';
  const days = Math.round((dayStart(now) - dayStart(ms)) / DAY);
  if (days <= 0) return 'active today';
  if (days === 1) return 'yesterday';
  if (days <= 30) return `${days} days ago`;
  return dMMM(ms);
}

/** "last used now / today / yesterday / N days ago / d MMM", or "never used".
 * @param {number | null} ms @param {number} [now] */
export function lastUsed(ms, now = Date.now()) {
  if (ms == null) return 'never used';
  const a = lastActive(ms, now);
  return a === 'active now' ? 'last used now' : a === 'active today' ? 'last used today' : `last used ${a}`;
}

/** "{Region}, {CC}", never a city; the last country seen when it differs. @param {SessionItem} s */
export function place(s) {
  const first = [s.region, s.country].filter(Boolean).join(', ');
  if (!first && !s.last_country) return 'Location unknown';
  const later = s.last_country && s.last_country !== s.country ? ` · now ${s.last_country}` : '';
  return `${first || s.last_country}${first ? later : ''} · approximate`;
}

/** @type {Record<AgentRole, { label: string, name: string, does: string, goes: string }>} */
export const ROLES = {
  'mind:chat': { label: 'Mind · chat', name: 'mind-chat', does: 'Talks with you and works for you; asks before anything big.', goes: 'Paste it into the Claude environment `th-chat` as the secret `TH_TOKEN`.' },
  'mind:night': { label: 'Mind · night', name: 'mind-night', does: 'Works overnight: reads, tidies and writes your briefing.', goes: 'Paste it into the Claude environment `th-night` as the secret `TH_TOKEN`.' },
  'mind:reflex': { label: 'Mind · reflex', name: 'mind-reflex', does: 'Watches for breakage and reports it (from P4).', goes: 'Paste it into the Claude environment `th-reflex` as the secret `TH_TOKEN`.' },
  muse: { label: 'Muse', name: 'muse', does: 'Reads and answers its own work orders.', goes: 'Send it to Muse in its settings.' },
  ci: { label: 'CI', name: 'ci', does: "Lets GitHub check the API's health after a deploy.", goes: 'Add it in GitHub as the environment secret `TH_CI_TOKEN`.' },
};

/** "today 14:05" or "3 Oct 14:05". @param {number} ms @param {number} now */
const when = (ms, now) => (dayStart(ms) === dayStart(now) ? `today ${hhmm(ms)}` : `${dMMM(ms)} ${hhmm(ms)}`);

/** "Thursday 14:05" @param {number} ms */
const weekdayTime = (ms) => `${new Date(ms).toLocaleDateString('en-GB', { weekday: 'long' })} ${hhmm(ms)}`;

/**
 * The card for one security notice: its text and buttons, in the order shown. `primary` is the
 * gold button; `answer` is what the tap sends (or a local action).
 * @param {Notice} n
 * @param {number} [now]
 * @returns {{ text: string, buttons: { label: string, act: 'not_me' | 'me' | 'ok' | 'cancel_reset' | 'hide' | 'agents', primary?: boolean }[] }}
 */
export function noticeCard(n, now = Date.now()) {
  const a = n.args ?? {};
  const label = a.label ?? 'another device';
  const at = a.at ?? n.created_at;
  switch (n.kind) {
    case 'new_device': {
      const where = [a.region, a.country].filter(Boolean).join(', ');
      return {
        text: `New sign-in: ${[label, where, when(at, now)].filter(Boolean).join(' · ')}`,
        buttons: [{ label: 'Not me — sign it out', act: 'not_me', primary: true }, { label: 'That was me', act: 'me' }],
      };
    }
    case 'password_changed':
      return {
        text: `Your password was changed on ${label} at ${hhmm(at)}.`,
        buttons: [{ label: 'Not me — sign out everywhere', act: 'not_me', primary: true }, { label: 'OK', act: 'ok' }],
      };
    case 'recovery_used':
    case 'reset_used':
      return { text: 'Your password was reset. Check your agent keys.', buttons: [{ label: 'Agent keys', act: 'agents', primary: true }, { label: 'OK', act: 'ok' }] };
    case 'reset_pending':
      return {
        text: `Someone asked to reset your password. It can be used after ${a.usable_after ? weekdayTime(a.usable_after) : 'a day'}.`,
        buttons: [{ label: 'Cancel it', act: 'cancel_reset', primary: true }, { label: 'That was me', act: 'hide' }],
      };
    case 'reset_cancelled':
      return { text: `The password reset was cancelled from ${label}.`, buttons: [{ label: 'OK', act: 'ok', primary: true }] };
    case 'agent_key_created': {
      const role = a.role && a.role in ROLES ? ROLES[/** @type {AgentRole} */ (a.role)].label : (a.role ?? 'agent');
      return {
        text: `A new agent key '${a.name ?? ''}' (${role}) was made on ${label}.`,
        buttons: [{ label: 'Not me — revoke it', act: 'not_me', primary: true }, { label: 'OK', act: 'ok' }],
      };
    }
    default:
      return { text: 'Something changed on your account.', buttons: [{ label: 'OK', act: 'ok', primary: true }] };
  }
}
