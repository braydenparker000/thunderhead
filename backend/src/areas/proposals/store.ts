// SQL for proposals inside Core (DATA.md §4.3). Every read goes through the primary key or one of
// the partial indexes (`proposals_open`, `proposals_ref`, `proposals_decided`), so none grows with
// the table: open cards are few (at most 3 an agent raised, plus the Worker's own).
import type {
  Actor,
  Proposal,
  ProposalClass,
  ProposalResult,
  ProposalSpec,
  ProposalStatus,
} from '../../../../shared/contract/api';
import type { Db } from '../../objects/base';

export interface ProposalRow {
  id: string;
  created_at: number;
  created_by: Actor;
  session_id: string | null;
  class: ProposalClass;
  question: string;
  why: string;
  if_ignored: string;
  odds: number | null;
  options_json: string;
  safe: 'reject' | 'snooze';
  spec_json: string;
  spec_hash: string;
  op: string;
  ref: string | null;
  status: ProposalStatus;
  expires_at: number;
  visible_from: number;
  show_from: number;
  snoozes: number;
  decided_at: number | null;
  decided_by_device: string | null;
  decided_via: 'tap' | 'words' | null;
  decided_message_id: string | null;
  executed_ledger_id: string | null;
  result_json: string | null;
  req_sha256: string | null;
}

const COLS = `id, created_at, created_by, session_id, class, question, why, if_ignored, odds, options_json, safe,
  spec_json, spec_hash, op, ref, status, expires_at, visible_from, show_from, snoozes, decided_at,
  decided_by_device, decided_via, decided_message_id, executed_ledger_id, result_json, req_sha256`;
/** The exact term of the `proposals_open` index, so SQLite can use it. */
const OPEN = `status IN ('waiting', 'approved')`;

export type NewProposal = Pick<
  ProposalRow,
  | 'id'
  | 'created_at'
  | 'created_by'
  | 'session_id'
  | 'class'
  | 'question'
  | 'why'
  | 'if_ignored'
  | 'odds'
  | 'options_json'
  | 'safe'
  | 'spec_json'
  | 'spec_hash'
  | 'op'
  | 'ref'
  | 'expires_at'
  | 'visible_from'
  | 'show_from'
  | 'req_sha256'
>;

export function insert(db: Db, p: NewProposal): void {
  db.run(
    `INSERT INTO proposals (id, created_at, created_by, session_id, class, question, why, if_ignored, odds,
       options_json, safe, spec_json, spec_hash, op, ref, status, expires_at, visible_from, show_from, req_sha256)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?, ?)`,
    p.id,
    p.created_at,
    p.created_by,
    p.session_id,
    p.class,
    p.question,
    p.why,
    p.if_ignored,
    p.odds,
    p.options_json,
    p.safe,
    p.spec_json,
    p.spec_hash,
    p.op,
    p.ref,
    p.expires_at,
    p.visible_from,
    p.show_from,
    p.req_sha256,
  );
}

export function byId(db: Db, id: string): ProposalRow | null {
  return db.one<ProposalRow>(`SELECT ${COLS} FROM proposals WHERE id = ?`, id);
}

/** Waiting cards and approvals still running, oldest first. */
export function open(db: Db): ProposalRow[] {
  return db.all<ProposalRow>(`SELECT ${COLS} FROM proposals WHERE ${OPEN} ORDER BY created_at LIMIT 100`);
}

/** The cards waiting now, oldest first. */
export function waiting(db: Db): ProposalRow[] {
  return open(db).filter((p) => p.status === 'waiting');
}

/** Every card that names this thing, newest first. */
export function byRef(db: Db, ref: string): ProposalRow[] {
  return db.all<ProposalRow>(
    `SELECT ${COLS} FROM proposals WHERE ref IS NOT NULL AND ref = ? ORDER BY created_at DESC LIMIT 20`,
    ref,
  );
}

/** A page, newest first: waiting cards only, or every proposal by its time-ordered id. */
export function page(db: Db, status: 'waiting' | 'all', before: string | null, limit: number): ProposalRow[] {
  if (status === 'waiting')
    return waiting(db)
      .reverse()
      .filter((p) => before === null || p.id < before)
      .slice(0, limit);
  return db.all<ProposalRow>(
    `SELECT ${COLS} FROM proposals WHERE (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?`,
    before,
    before,
    limit,
  );
}

export interface Decision {
  status: ProposalStatus;
  decided_at: number;
  decided_by_device?: string | null;
  decided_via?: 'tap' | 'words' | null;
  decided_message_id?: string | null;
}

export function decide(db: Db, id: string, d: Decision): void {
  db.run(
    `UPDATE proposals SET status = ?, decided_at = ?, decided_by_device = ?, decided_via = ?, decided_message_id = ?
     WHERE id = ?`,
    d.status,
    d.decided_at,
    d.decided_by_device ?? null,
    d.decided_via ?? null,
    d.decided_message_id ?? null,
    id,
  );
}

/** What approving it did: `executed` or `failed`, its result and the ledger row it wrote. */
export function finish(
  db: Db,
  id: string,
  status: 'executed' | 'failed',
  result: ProposalResult,
  ledgerId: string | null,
): void {
  db.run(
    'UPDATE proposals SET status = ?, result_json = ?, executed_ledger_id = ? WHERE id = ?',
    status,
    JSON.stringify(result),
    ledgerId,
    id,
  );
}

export function snooze(db: Db, id: string, showFrom: number): void {
  db.run('UPDATE proposals SET snoozes = snoozes + 1, show_from = ? WHERE id = ?', showFrom, id);
}

/** Waiting cards past their time become `expired` (nothing happens); returns their ids. */
export function expireDue(db: Db, at: number): string[] {
  return db
    .all<{ id: string }>(
      `UPDATE proposals SET status = 'expired', decided_at = expires_at
       WHERE ${OPEN} AND status = 'waiting' AND expires_at <= ? RETURNING id`,
      at,
    )
    .map((r) => r.id);
}

/** Whether a message already answered a card decided since it was sent (one message, one card). */
export function decidedByMessage(db: Db, messageId: string, since: number): boolean {
  return (
    db.one(
      'SELECT 1 FROM proposals WHERE decided_at IS NOT NULL AND decided_at >= ? AND decided_message_id = ? LIMIT 1',
      since,
      messageId,
    ) !== null
  );
}

/** A card's words when what it names is forgotten: the fact's text must not outlive it. */
export function scrubWords(db: Db, id: string, question: string, why: string): void {
  db.run('UPDATE proposals SET question = ?, why = ? WHERE id = ?', question, why, id);
}

/** Decided proposals a year on (DATA.md §10, PRIVACY.md §2), on the `proposals_decided` index. */
export function prune(db: Db, now: number, max: number): number {
  return db.all(
    `DELETE FROM proposals WHERE id IN (SELECT id FROM proposals WHERE decided_at IS NOT NULL AND decided_at < ?
       AND status NOT IN ('waiting', 'approved') LIMIT ?) RETURNING 1`,
    now - 365 * 86_400_000,
    max,
  ).length;
}

export function toProposal(r: ProposalRow): Proposal {
  return {
    id: r.id,
    created_at: r.created_at,
    created_by: r.created_by,
    class: r.class,
    question: r.question,
    why: r.why,
    if_ignored: r.if_ignored,
    odds: r.odds,
    options: JSON.parse(r.options_json) as string[],
    safe: r.safe,
    spec: JSON.parse(r.spec_json) as ProposalSpec,
    spec_hash: r.spec_hash,
    status: r.status,
    expires_at: r.expires_at,
    show_from: r.show_from,
    snoozes: r.snoozes,
    decided_at: r.decided_at,
    decided_via: r.decided_via,
    decided_message_id: r.decided_message_id,
    result: r.result_json === null ? null : (JSON.parse(r.result_json) as ProposalResult),
  };
}
