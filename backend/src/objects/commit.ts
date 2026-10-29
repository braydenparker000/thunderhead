// The one write path of the Core object (EXTENDING.md rule 4). Every state change runs inside
// `commit`: the area's mutation, its change-feed rows and (for actions) its ledger row commit in
// one transaction, and the live channel hears about it afterwards. Stores never write `changes`
// or `ledger` themselves; a source test checks that only this file calls those inserts, so no
// route can change state without the phone and the mind seeing it.
import type { Actor, LedgerKind } from '../../../shared/contract/api';
import type { ChangeKind } from '../../../shared/contract/feed.ts';
import * as feed from '../areas/feed/store';
import * as ledger from '../areas/ledger/store';
import { uuidv7 } from '../lib/ids';
import type { Db } from './base';

/** A ledger row as an area describes it; ids, time and the feed entry are added here. */
export interface LedgerDraft {
  id?: string;
  kind: LedgerKind;
  actor: Actor;
  what: string;
  why: string;
  ref?: string | null;
  topic_key?: string | null;
  /** The inverse, stored when written (DATA.md §4.3): `{op, args}` for Core-internal actions,
   * `{verb, schema, args}` for phone actions. */
  undo?: Record<string, unknown> | null;
  undoable?: boolean;
  status?: 'done' | 'failed';
  session_id?: string | null;
  verb_id?: string | null;
  op?: Record<string, unknown> | null;
  tainted?: boolean;
  /** For agent-created rows (PUT /v1/ledger/:id): the canonical body hash (API.md §7). */
  req_sha256?: string | null;
  /** The proposal this row belongs to (else the one the Writer is running, below). */
  proposal_id?: string | null;
}

export class Writer {
  readonly kinds = new Set<ChangeKind>();
  seq = 0;
  /** Set while an approved proposal's op runs: every ledger row it writes carries its id. */
  proposal: string | null = null;

  constructor(
    readonly db: Db,
    readonly at: number,
  ) {}

  /** One change-feed row; clients pull `/v1/changes` from it. */
  change(kind: ChangeKind, ref: string | null = null): void {
    this.seq = feed.addChange(this.db, kind, ref, this.at);
    this.kinds.add(kind);
  }

  /** One ledger row (and its feed entry). Returns the ledger id. */
  ledger(d: LedgerDraft): string {
    const id = d.id ?? uuidv7(this.at);
    ledger.insert(this.db, {
      id,
      at: this.at,
      actor: d.actor,
      session_id: d.session_id ?? null,
      kind: d.kind,
      what: d.what,
      why: d.why,
      ref: d.ref ?? null,
      topic_key: d.topic_key ?? null,
      undo_json: d.undo ? JSON.stringify({ v: 1, ...d.undo }) : null,
      undoable: d.undoable ?? Boolean(d.undo),
      status: d.status ?? 'done',
      tainted: d.tainted ?? false,
      op_json: d.op ? JSON.stringify({ v: 1, ...d.op }) : null,
      verb_id: d.verb_id ?? null,
      req_sha256: d.req_sha256 ?? null,
      proposal_id: d.proposal_id ?? this.proposal,
    });
    this.change('ledger', `ledger:${id}`);
    return id;
  }
}

export interface Committed<T> {
  value: T;
  kinds: ChangeKind[];
  seq: number;
}

/** Runs `fn` in one SQLite transaction with a Writer. A throw rolls back everything. */
export function commit<T>(storage: DurableObjectStorage, db: Db, fn: (w: Writer) => T, at = Date.now()): Committed<T> {
  const w = new Writer(db, at);
  const value = storage.transactionSync(() => fn(w));
  return { value, kinds: [...w.kinds], seq: w.seq };
}
