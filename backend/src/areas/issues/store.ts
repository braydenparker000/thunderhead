// SQL for the list for the builder inside Core (DATA.md §4.1). Stores never write the change feed.
import type { Issue, IssueKind, IssueNote, IssueState } from '../../../../shared/contract/issues.ts';
import { DAY } from '../../lib/time';
import type { Db } from '../../objects/base';
import { newestErrorOn } from '../ops/store';
import { NEWEST, page as reportsPage } from '../reports/store';

export interface IssueRow {
  id: string;
  at: number;
  title: string;
  what: string;
  place: string | null;
  kind: IssueKind;
  origin: Issue['origin'];
  from_message_id: string | null;
  release: string | null;
  seen: string | null;
  state: IssueState;
  done_at: number | null;
  updated_at: number;
  req_sha256: string;
}

const COLS =
  'id, at, title, what, place, kind, origin, from_message_id, release, seen, state, done_at, updated_at, req_sha256';

export function byId(db: Db, id: string): IssueRow | null {
  return db.one<IssueRow>(`SELECT ${COLS} FROM issues WHERE id = ?`, id);
}

export function insert(db: Db, r: IssueRow): void {
  db.run(
    `INSERT INTO issues (${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    r.id,
    r.at,
    r.title,
    r.what,
    r.place,
    r.kind,
    r.origin,
    r.from_message_id,
    r.release,
    r.seen,
    r.state,
    r.done_at,
    r.updated_at,
    r.req_sha256,
  );
}

export function update(db: Db, r: IssueRow): void {
  db.run(
    'UPDATE issues SET title = ?, what = ?, place = ?, kind = ?, state = ?, done_at = ?, updated_at = ? WHERE id = ?',
    r.title,
    r.what,
    r.place,
    r.kind,
    r.state,
    r.done_at,
    r.updated_at,
    r.id,
  );
}

/** One state's items (or every item), newest first. */
export function list(db: Db, state: IssueState | null, limit: number): IssueRow[] {
  return state
    ? db.all<IssueRow>(`SELECT ${COLS} FROM issues WHERE state = ? ORDER BY at DESC, id DESC LIMIT ?`, state, limit)
    : db.all<IssueRow>(`SELECT ${COLS} FROM issues ORDER BY at DESC, id DESC LIMIT ?`, limit);
}

export function notes(db: Db, issueId: string): IssueNote[] {
  return db.all<IssueNote>('SELECT id, at, by, text FROM issue_notes WHERE issue_id = ? ORDER BY id', issueId);
}

export function noteCount(db: Db, issueId: string): number {
  return db.one<{ n: number }>('SELECT count(*) AS n FROM issue_notes WHERE issue_id = ?', issueId)?.n ?? 0;
}

export function addNote(db: Db, issueId: string, n: IssueNote): void {
  db.run(
    'INSERT INTO issue_notes (issue_id, id, at, by, text) VALUES (?, ?, ?, ?, ?)',
    issueId,
    n.id,
    n.at,
    n.by,
    n.text,
  );
}

export function shown(db: Db, r: IssueRow): Issue {
  const { place, req_sha256: _, ...rest } = r;
  return { ...rest, where: place, notes: notes(db, r.id) };
}

/** What the site knew then: the newest error of the last week whose route names the place, else
 * (for Music, the one app that reports) the newest playback report of the last day. */
export function seenFor(db: Db, place: string | null, now: number): string | null {
  if (!place) return null;
  const err = newestErrorOn(db, place, now - 7 * DAY);
  if (err) return `error:${err}`;
  if (!/music/i.test(place)) return null;
  const [rep] = reportsPage(db, 'playback', now - DAY, NEWEST, 1);
  return rep ? `report:${rep.id}` : null;
}
