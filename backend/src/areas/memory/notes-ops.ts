// Open threads (commitments and loose ends) and day notes (API.md §11.13, MEMORY.md §2, §11).
// Each write is one ledger row whose undo restores what was there; the same body again changes
// nothing, so a night step that reruns never writes a second version, and the owner's edit of a
// day note is never written over by the night. A mind writes from a claimed, live session; a
// tainted one may still add a loose end ("remember: …", MEMORY.md §7.4) but no day note.
import {
  type DayNote,
  neverStored,
  type OpenThread,
  type PatchOpenThreadRequest,
  type PutDayNoteRequest,
  type PutOpenThreadRequest,
} from '../../../../shared/contract/memory.ts';
import { uuidv7 } from '../../lib/ids';
import { Fail, invalid } from '../../lib/result';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { dayCounts } from '../conversation/stats';
import { messageOrigin, thread } from '../conversation/store';
import { byId as ledgerRow } from '../ledger/store';
import { claimedSession } from '../mind/guards';
import * as notes from './notes';
import * as store from './store';

const REF = /^([a-z][a-z0-9]{1,15}):([A-Za-z0-9._:/-]{1,160})(#[A-Za-z0-9._:-]{1,64})?$/;
const fold = (t: string) => t.replace(/\s+/g, ' ').trim();

/** A loose end's evidence: 1–20 refs that exist (a device may cite nothing: its own row). */
function cited(w: Writer, c: Caller, refs: string[], self: string): string[] {
  const list = [...new Set(refs.map((r) => r.trim()).filter(Boolean))];
  if (!list.length && c.who === 'D') list.push(`ledger:${self}`);
  if (list.length < 1 || list.length > 20) throw invalid('evidence', '1–20 refs');
  for (const r of list) {
    const m = REF.exec(r);
    if (!m) throw invalid('evidence', `${r.slice(0, 40)} is not a ref`);
    const [, kind, key] = m;
    const known =
      kind === 'msg'
        ? messageOrigin(w.db, key) !== null
        : kind === 'day'
          ? notes.dayNote(w.db, key) !== null
          : kind === 'fact'
            ? store.fact(w.db, key) !== null
            : kind === 'open'
              ? notes.openThread(w.db, key) !== null
              : kind === 'ledger'
                ? key === self || ledgerRow(w.db, key) !== null
                : kind === 'thread' && thread(w.db, key) !== null;
    if (!known) throw invalid('evidence', `${r.slice(0, 40)} does not exist`);
  }
  return list;
}

const WORDS = {
  open: 'opened a loose end',
  update: 'updated a loose end',
  done: 'closed a loose end',
  dropped: 'dropped a loose end',
  reopen: 'reopened a loose end',
} as const;

/** A mind writes loose ends and day notes only from a claimed, live session of its role (a
 * tainted one may still note a loose end, MEMORY.md §7.4). */
function mindSession(w: Writer, c: Caller): { tainted: boolean } | null {
  return c.who === 'D' ? null : claimedSession(w.db, c.session_id, c.who === 'N' ? 'night' : 'chat');
}

/** Text a loose end or a day note keeps: one paragraph, nothing MEMORY.md §13 never stores. */
function clean(path: string, t: string): string {
  const one = fold(t);
  if (neverStored(one)) throw invalid(path, 'never_stored');
  return one;
}

export function putThread(w: Writer, c: Caller, id: string, r: PutOpenThreadRequest): OpenThread {
  mindSession(w, c);
  const before = notes.openThread(w.db, id);
  const status = r.status ?? before?.status ?? 'open';
  const why = r.why === undefined ? null : clean('why', r.why);
  if (status === 'dropped' && !why && before?.status !== 'dropped') throw invalid('why', 'required to drop it');
  const self = uuidv7(w.at);
  const text = clean('text', r.text);
  if (!text) throw invalid('text', 'required');
  const tags = [...new Set(r.tags ?? store.strings(before?.tags_json ?? null))];
  const closing = status !== 'open' && before?.status !== status;
  const row: notes.OpenThreadRow = {
    id,
    text,
    owner: r.owner,
    due_at: r.due_at ?? null,
    tags_json: tags.length ? JSON.stringify(tags) : null,
    status,
    // The owner editing a loose end without citing anything keeps what it already cites.
    evidence_json:
      before && !r.evidence.length && c.who === 'D'
        ? before.evidence_json
        : JSON.stringify(cited(w, c, r.evidence, self)),
    opened_at: before?.opened_at ?? w.at,
    last_progress_at: before ? w.at : null,
    closed_at: status === 'open' ? null : closing ? w.at : (before?.closed_at ?? w.at),
    closed_why: status === 'open' ? null : closing ? why : (why ?? before?.closed_why ?? null),
  };
  // The same body again (a retried call, a rerun night step) changes nothing.
  if (before && notes.sameThread({ ...row, last_progress_at: before.last_progress_at }, before))
    return notes.toOpenThread(before);
  write(w, c, row, before, self, !before ? 'open' : closing ? status : before.status !== 'open' ? 'reopen' : 'update');
  return notes.toOpenThread(row);
}

export function patchThread(w: Writer, c: Caller, id: string, r: PatchOpenThreadRequest): OpenThread {
  mindSession(w, c);
  const before = notes.openThread(w.db, id);
  if (!before) throw new Fail('not_found');
  const why = r.why === undefined ? null : clean('why', r.why);
  if (r.status === 'dropped' && !why) throw invalid('why', 'required to drop it');
  if (before.status === r.status) return notes.toOpenThread(before);
  const row = { ...before, status: r.status, last_progress_at: w.at, closed_at: w.at, closed_why: why };
  write(w, c, row, before, uuidv7(w.at), r.status);
  return notes.toOpenThread(row);
}

function write(
  w: Writer,
  c: Caller,
  row: notes.OpenThreadRow,
  before: notes.OpenThreadRow | null,
  self: string,
  what: keyof typeof WORDS,
): void {
  const device = c.who === 'D';
  w.ledger({
    id: self,
    kind: 'memory',
    actor: c.actor,
    session_id: c.session_id,
    what: WORDS[what],
    why:
      row.closed_why && what === 'dropped'
        ? `dropped: ${row.closed_why}`
        : device
          ? 'the owner changed it'
          : 'from the conversation',
    ref: `open:${row.id}`,
    undo: { op: 'open.restore', args: { id: row.id, before, after: row } },
  });
  notes.putOpenThread(w.db, row);
  w.change('open_thread', `open:${row.id}`);
}

/** PUT /v1/memory/day-notes/:day: the night shift's note, or the owner's edit; `stats` are the
 * Worker's own counts. A body equal to the stored one keeps its version. */
export function putDayNote(w: Writer, c: Caller, day: string, today: string, r: PutDayNoteRequest): DayNote {
  // A day note is evidence later (M2), so a tainted session never writes one.
  if (mindSession(w, c)?.tainted) throw new Fail('session_tainted');
  if (day > today) throw invalid('day', 'not a future day');
  const summary = clean('summary', r.summary);
  if (!summary) throw invalid('summary', 'required');
  const decisions = (Array.isArray(r.decisions) ? r.decisions : []).map((d) => clean('decisions', d)).filter(Boolean);
  const before = notes.dayNote(w.db, day);
  // The owner's edit wins: the night shift never writes over it (it reads the owner's version).
  if (before?.written_by === 'owner' && c.who !== 'D') return notes.toDayNote(before);
  const decisionsJson = JSON.stringify(decisions);
  if (
    before &&
    before.summary === summary &&
    (before.decisions_json ?? '[]') === decisionsJson &&
    before.importance === r.importance
  )
    return notes.toDayNote(before);
  const row = {
    day,
    summary,
    decisions_json: decisionsJson,
    stats_json: JSON.stringify(dayCounts(w.db, day)),
    importance: r.importance,
    written_by: c.who === 'D' ? 'owner' : (c.session_id ?? c.actor),
    version: (before?.version ?? 0) + 1,
    written_at: w.at,
  };
  const { seq: _seq, ...was } = before ?? { seq: 0 };
  w.ledger({
    kind: 'memory',
    actor: c.actor,
    session_id: c.session_id,
    what: `${before ? 'rewrote' : 'wrote'} the day note for ${day}`,
    why: c.who === 'D' ? 'the owner edited it' : 'the night shift summed up the day',
    ref: `day:${day}`,
    undo: { op: 'day.restore', args: { day, version: row.version, before: before ? was : null } },
  });
  notes.putDayNote(w.db, row, before);
  w.change('day_note', `day:${day}`);
  return notes.toDayNote({ seq: before?.seq ?? 0, ...row });
}
