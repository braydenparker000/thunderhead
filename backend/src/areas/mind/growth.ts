// Night step 13, the week's growth (shared/contract/growth.ts; PUT /v1/mind/growth/:day, `th growth`):
// from a claimed night session, for a closed day with a night run, the week's counts the route read
// (the Senses object's `guitar_week` and `study_week`, the Library's places) become the Briefing's
// `practice` and `study` tiles (growth-words.ts) and tomorrow's plan and next passage through
// guitar.set_plan and study.mark_next, each through its own path and gates (surfaces/ops.ts,
// verbs/ops.ts: the topic, speech and permit gates; the verb's ledger row and undo), each in its
// own commit so one refused (a topic the owner dismissed: nudge_repeat) leaves the others. Under
// GROWTH.min_sessions the app gets nothing. A tile or plan the same as the one in its slot is not
// written again, so a rerun of the step changes nothing.
import type {
  GrowthPart,
  GrowthResponse,
  GuitarWeek,
  StudyPlace,
  StudyWeek,
} from '../../../../shared/contract/growth.ts';
import { uuidv7 } from '../../lib/ids';
import { invalid, type Out } from '../../lib/result';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { currentOf } from '../memory/subject';
import * as surfaces from '../surfaces/ops';
import { get as slotOf } from '../surfaces/store';
import { PACE_SUBJECT } from '../verbs/apps';
import * as verbs from '../verbs/ops';
import { guitarWords, type Part, studyWords } from './growth-words';
import { claimedSession } from './guards';
import { nightRun } from './night';

export interface GrowthInput {
  guitar: GuitarWeek;
  study: StudyWeek;
  places: StudyPlace[];
  rows_read: number;
}
type Run = <T>(fn: (w: Writer) => T) => Out<T>;

/** JSON with its keys in order, so two payloads compare by what they hold. */
const canon = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canon).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`)
          .join(',')}}`
      : JSON.stringify(v);

/** The slot's ledger row when it already holds exactly this payload (and, for a tile, this why). */
function same(w: Writer, app: string, slot: string, payload: object, why?: string): string | null {
  const row = slotOf(w.db, app, slot);
  if (!row || (why !== undefined && row.why !== why)) return null;
  const { v: _v, ...was } = JSON.parse(row.payload_json) as Record<string, unknown>;
  return canon(was) === canon(payload) ? row.ledger_id : null;
}

function placeTile(w: Writer, c: Caller, slot: string, t: NonNullable<Part['tile']>, tz: string): string | null {
  const had = same(w, 'briefing', slot, t.payload, t.why);
  if (had) return had;
  const r = { kind: 'tile', schema: 1, payload: { ...t.payload }, why: t.why, topic_key: `growth.${t.payload.app}` };
  return surfaces.put(w, c, 'briefing', slot, r, tz).ledger_id;
}

function placePlan(w: Writer, c: Caller, verb: string, at: string, p: NonNullable<Part['plan']>, tz: string) {
  const [app, slot] = at.split('/');
  const had = same(w, app, slot, p.args);
  if (had) return had;
  const id = uuidv7(w.at);
  const r = { verb, schema: 1, args: p.args as never, why: p.why, ref: p.args.tab ?? p.args.book };
  return verbs.put(w, c, id, r as never, id, () => tz).verb.ledger_id;
}

function part(run: Run, c: Caller, p: Part, slot: string, verb: string, at: string, tz: string): GrowthPart {
  const out: GrowthPart = { sessions: p.sessions, tile: null, plan: null, reason: p.reason };
  if (p.plan) {
    const plan = p.plan;
    const r = run((w) => placePlan(w, c, verb, at, plan, tz));
    if (r.ok) out.plan = r.value;
    else out.reason ??= r.code;
  }
  if (p.tile) {
    const tile = p.tile;
    const r = run((w) => placeTile(w, c, slot, tile, tz));
    if (r.ok) out.tile = r.value;
    else out.reason ??= r.code;
  }
  return out;
}

export function growth(
  run: Run,
  c: Caller,
  day: string,
  x: GrowthInput,
  ctx: { today: (w: Writer) => string; tz: string },
): Out<GrowthResponse> {
  // The owner's own pace (study.pace_goal, their words), when they set one: the passage keeps to it.
  const ok = run((w) => {
    if (day >= ctx.today(w)) throw invalid('day', 'a day that has closed');
    claimedSession(w.db, c.session_id, 'night');
    if (!nightRun(w.db, day)) throw invalid('day', 'the day of a night run');
    const goal = /(\d+) pages a week/.exec(currentOf(w.db, 'goal', PACE_SUBJECT, w.at)?.text ?? '');
    return goal ? Number(goal[1]) : null;
  });
  if (!ok.ok) return ok;
  return {
    ok: true,
    value: {
      day,
      from: x.guitar.from,
      guitar: part(run, c, guitarWords(x.guitar), 'practice', 'guitar.set_plan', 'guitar/today', ctx.tz),
      study: part(run, c, studyWords(x.study, x.places, ok.value), 'study', 'study.mark_next', 'study/next', ctx.tz),
      rows_read: x.rows_read,
    },
  };
}
