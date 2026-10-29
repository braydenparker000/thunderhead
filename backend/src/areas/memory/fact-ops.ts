// The fact ops of a memory batch (MEMORY.md §3): add, supersede and confirm, each checked by the
// provenance rules (validate.ts) before it writes one ledger row (with its inverse, never the
// fact's text) and the version itself. ops.ts runs the batch; owner-ops.ts has the owner's own.
import {
  CONFIDENCE,
  FACT_SOURCES,
  type FactSource,
  IMPORTED_TAG,
  type MemoryOpsResponse,
  OWNER_ONLY_TAGS,
  SENSITIVE_TAGS,
} from '../../../../shared/contract/memory.ts';
import { uuidv7 } from '../../lib/ids';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import * as store from './store';
import { askFirst, clean, content, evidence, type FactShape, type OpContext, type ParsedOp, Reject } from './validate';

export type Applied = Omit<MemoryOpsResponse['applied'][number], 'i'>;

export const short = (id: string) => `fact:${id}`;
const cites = (refs: string[]) => `from ${refs[0]}${refs.length > 1 ? ` and ${refs.length - 1} more` : ''}`;
const has = (tags: string[], list: readonly string[]) => tags.some((t) => list.includes(t));

/** The starting confidence of a source (MEMORY.md §4); an imported guess starts at 0.6. */
function base(source: FactSource, tags: string[]): number {
  return source === 'inferred' && tags.includes(IMPORTED_TAG) ? CONFIDENCE.imported : FACT_SOURCES[source].base;
}

/** The checks every new version passes: taint, content rules, evidence, a fresh id, ask-first. */
function admit(ctx: OpContext, f: FactShape, id: string, given: string[] | undefined): string[] {
  clean(ctx);
  content(ctx, f);
  const refs = evidence(ctx, given, f.source);
  if (store.fact(ctx.db, id)) throw new Reject('duplicate_id');
  askFirst(f);
  return refs;
}

function writtenBy(c: Caller): string {
  return c.who === 'D' ? 'owner' : (c.session_id ?? c.actor);
}

function insert(w: Writer, ctx: OpContext, f: store.NewFact): void {
  store.insertFact(w.db, { ...f, ledger_id: ctx.selfLedger });
  w.change('fact', short(f.id));
}

type Add = Extract<ParsedOp, { op: 'add' }>;

export function add(w: Writer, c: Caller, ctx: OpContext, op: Add): Applied {
  const source: FactSource = ctx.device ? 'user' : op.source;
  if (ctx.device && op.source !== 'user') throw new Reject('bad_op');
  const tags = [...new Set(op.tags ?? [])];
  const shape: FactShape = {
    kind: op.kind,
    source,
    about: op.about ?? 'owner',
    tags,
    sensitivity: op.sensitivity === 1 || has(tags, SENSITIVE_TAGS) ? 1 : 0,
  };
  const refs = admit(ctx, shape, op.id, op.evidence);
  const ledgerId = w.ledger({
    id: ctx.selfLedger,
    kind: 'memory',
    actor: c.actor,
    session_id: c.session_id,
    what: `remembered a ${op.kind}`,
    why: ctx.device ? 'the owner added it on the Memory page' : cites(refs),
    ref: short(op.id),
    undo: { op: 'memory.close', args: { fact_id: op.id } },
  });
  insert(w, ctx, {
    id: op.id,
    kind: op.kind,
    about: shape.about as store.NewFact['about'],
    subject: op.subject ?? null,
    text: op.text,
    tags_json: tags.length ? JSON.stringify(tags) : null,
    source,
    confidence: Math.min(FACT_SOURCES[source].cap, base(source, tags)),
    evidence_json: JSON.stringify(refs),
    valid_from: op.valid_from ?? null,
    valid_to: null,
    recorded_at: w.at,
    superseded_at: null,
    superseded_by: null,
    last_confirmed: w.at,
    sensitivity: shape.sensitivity,
    pinned: 0,
    may_raise: (op.may_raise ?? !has(tags, OWNER_ONLY_TAGS)) ? 1 : 0,
    written_by: writtenBy(c),
    ledger_id: ledgerId,
  });
  return { fact_id: op.id, ledger_id: ledgerId };
}

/** The current version a supersede, confirm or flag works on. */
export function current(ctx: OpContext, id: string): store.FactRow {
  const f = store.fact(ctx.db, id);
  if (!f) throw new Reject('unknown_ref');
  if (f.superseded_at !== null) throw new Reject('superseded');
  return f;
}

type Supersede = Extract<ParsedOp, { op: 'supersede' }>;

export function supersede(w: Writer, c: Caller, ctx: OpContext, op: Supersede, why?: string): Applied {
  clean(ctx);
  const old = current(ctx, op.id);
  const n = op.new;
  if (ctx.device && n.source !== undefined && n.source !== 'user') throw new Reject('bad_op');
  const source: FactSource = ctx.device ? 'user' : (n.source ?? old.source);
  const tags = [...new Set(n.tags ?? store.strings(old.tags_json))];
  const shape: FactShape = {
    kind: n.kind ?? old.kind,
    source,
    about: n.about ?? old.about,
    tags,
    sensitivity: (n.sensitivity ?? old.sensitivity) === 1 || has(tags, SENSITIVE_TAGS) ? 1 : 0,
  };
  const refs = admit(ctx, shape, n.id, n.evidence);
  if (old.source === 'user' && source !== 'user') throw new Reject('proposal_required'); // M9
  const ledgerId = w.ledger({
    id: ctx.selfLedger,
    kind: 'memory',
    actor: c.actor,
    session_id: c.session_id,
    what: `updated a ${shape.kind}`,
    why: why ?? op.reason ?? (ctx.device ? 'the owner fixed it on the Memory page' : cites(refs)),
    ref: short(n.id),
    undo: { op: 'memory.reopen', args: { old_id: old.id, new_id: n.id, valid_to: old.valid_to } },
  });
  store.closeFact(w.db, old.id, w.at, n.id, n.valid_from ?? null);
  w.change('fact', short(old.id));
  insert(w, ctx, {
    id: n.id,
    kind: shape.kind as store.NewFact['kind'],
    about: shape.about as store.NewFact['about'],
    subject: n.subject ?? old.subject,
    text: n.text,
    tags_json: tags.length ? JSON.stringify(tags) : null,
    source,
    confidence: Math.min(FACT_SOURCES[source].cap, base(source, tags)),
    evidence_json: JSON.stringify(refs),
    valid_from: n.valid_from ?? old.valid_from,
    valid_to: null,
    recorded_at: w.at,
    superseded_at: null,
    superseded_by: null,
    last_confirmed: w.at,
    sensitivity: shape.sensitivity,
    pinned: old.pinned,
    may_raise: (n.may_raise ?? old.may_raise === 1) ? 1 : 0,
    written_by: writtenBy(c),
    ledger_id: ledgerId,
  });
  return { fact_id: n.id, ledger_id: ledgerId };
}

type Confirm = Extract<ParsedOp, { op: 'confirm' }>;

/** Still true: confidence up to its source's base and the decay clock reset. Confirmed in the
 * owner's own words, a fact that was not `user` becomes a `user` version ("Yes, that's right"). */
export function confirm(w: Writer, c: Caller, ctx: OpContext, op: Confirm): Applied {
  clean(ctx);
  const f = current(ctx, op.id);
  let ownerWords = true;
  let refs: string[];
  try {
    refs = evidence(ctx, op.evidence, 'user');
  } catch (e) {
    if (!(e instanceof Reject) || e.reason !== 'not_owner_evidence') throw e;
    ownerWords = false;
    refs = evidence(ctx, op.evidence, 'inferred');
  }
  if (ownerWords && f.source !== 'user') {
    const tags = store.strings(f.tags_json).filter((t) => t !== IMPORTED_TAG);
    const lift: Supersede = {
      op: 'supersede',
      id: f.id,
      new: { id: uuidv7(w.at), text: f.text, evidence: refs, source: 'user', tags },
    };
    return supersede(w, c, ctx, lift, ctx.device ? 'the owner said it is right' : `confirmed ${cites(refs)}`);
  }
  const seen = FACT_SOURCES[ownerWords ? 'user' : 'inferred'].base;
  const confidence = Math.min(FACT_SOURCES[f.source].cap, Math.max(f.confidence, seen));
  const ledgerId = w.ledger({
    id: ctx.selfLedger,
    kind: 'memory',
    actor: c.actor,
    session_id: c.session_id,
    what: `confirmed a ${f.kind}`,
    why: ctx.device ? 'the owner said it is still true' : cites(refs),
    ref: short(f.id),
    undo: { op: 'memory.restore', args: { fact_id: f.id, confidence: f.confidence, last_confirmed: f.last_confirmed } },
  });
  store.confirmFact(w.db, f.id, confidence, w.at);
  w.change('fact', short(f.id));
  return { fact_id: f.id, ledger_id: ledgerId };
}
