// The briefing's verb table (section 13, after the owner's settings; MIND-PLAN §3): every verb the
// mind may queue, one line each, from the contract (shared/contract/verbs.ts): its name, where it
// runs (`worker`: done at once; `app`: an intent its app applies when it opens; `phone`: the next
// signed-in phone), its class and the owner's position for it now, and its one line. The positions
// come from the section's own `mind.permit.<class>: <position>` lines, so it reads no row. Verbs
// only the owner taps, or only an undo queues, are left out; one line after the legend says how to
// schedule a verb and run a plan. Pure.
import { PERMIT_FLOORS } from '../../../../shared/contract/permits.ts';
import { PLAN_LIMITS, SCHEDULE_LIMITS } from '../../../../shared/contract/schedules.ts';
import { VERBS, type VerbSpec } from '../../../../shared/contract/verbs.ts';

/** The table's characters at most (the full briefing's section 13 holds it beside the settings). */
export const VERBS_MAX = 2_000;

export const VERBS_LEGEND =
  'Verbs (th verb <name> \'<args>\' --why "…"; th help lists their args): name · runs on · class: position now · what. worker = done before your reply ends; app = waits for that app to open (say so); phone = the next signed-in phone. Undo: th undo <ledger_id>.';

/** Scheduled actions and plans (verbs/schedule.ts, plan.ts), in one line after the legend; the verbs
 * that run only as they are asked come from the contract. */
const NOW_ONLY = (Object.entries(VERBS) as [string, VerbSpec][])
  .filter(([, v]) => v.now_only)
  .map(([n]) => n)
  .join(', ');
const { days_ahead: DAYS, pending: WAITING } = SCHEDULE_LIMITS;
export const LATER_LINE = `Later: th verb … --at <time> (local or with offset, ≤ ${DAYS} days, ≤ ${WAITING} waiting; music, podcasts wait out quiet hours: shifted; never ${NOW_ONLY}); th verb cancel <id> before it runs. Plans: th plan <file.json> --why "…" --what "<home line>": ${PLAN_LIMITS.min_steps}–${PLAN_LIMITS.max_steps} verbs in order, one undo, the strictest step decides (one card).`;

/** The positions in the settings lines (`mind.permit.music: quiet (default)`). */
function positions(settings: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of settings) {
    const m = /^mind\.permit\.([a-z_]+): (ask|tell|quiet)\b/.exec(l);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

function line(name: string, v: VerbSpec, at: Map<string, string>): string {
  const runs = v.side === 'worker' ? 'worker' : v.intent ? `app (${v.app})` : 'phone';
  let permit = "no class (the owner's own words only)";
  if (v.permit !== null) {
    const now = v.floor ? `ask (${PERMIT_FLOORS[v.floor]})` : (at.get(v.permit) ?? 'unknown');
    permit = `${v.permit}: ${v.tell_min && now === 'quiet' ? 'tell (never quiet)' : now}`;
  }
  return `${name} · ${runs} · ${permit} · ${v.what}`;
}

/** The table, under VERBS_MAX characters (a cut says where the rest is). */
export function verbTable(settings: readonly string[]): string {
  const at = positions(settings);
  const lines = [VERBS_LEGEND, LATER_LINE];
  for (const [name, v] of Object.entries(VERBS) as [string, VerbSpec][]) if (v.queueable) lines.push(line(name, v, at));
  let out = '';
  for (const [i, l] of lines.entries()) {
    if (out.length + l.length + 1 > VERBS_MAX - 40) return `${out}(+${lines.length - i} more: th help)`;
    out += `${l}\n`;
  }
  return out.trimEnd();
}
