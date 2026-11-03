// The fact ops of a memory batch (MEMORY.md §3): add, supersede and confirm, each checked by the
// provenance rules (validate.ts) before it writes one ledger row (with its inverse, never the
// fact's text) and the version itself. ops.ts runs the batch; owner-ops.ts has the owner's own.
// Every version carries its provenance (validate.ts `label`, MEMORY.md §6 M11): a session that read
// outside text writes `outside` versions, which wait for the owner's keep (a device confirm).
// The mind may only make a fact more protected (PRIVACY.md §4): never lower its sensitivity, never
// set "may raise" on its own, never drop a protecting tag; the owner may do either.
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
import {
  content,
  evidence,
  type FactShape,
  label,
  newestOwnerWords,
  noDisplace,
  type OpContext,
  type ParsedOp,
  Reject,
  sensitiveGuess,
} from './validate';

export type Applied = Omit<MemoryOpsResponse['applied'][number], 'i'>;

export const short = (id: string) => `fact:${id}`;
const cites = (refs: string[]) => `from ${refs[0]}${refs.length > 1 ? ` and ${refs.length - 1} more` : ''}`;
const has = (tags: string[], list: readonly string[]) => tags.some((t) => list.includes(t));
/** Tags only the owner may take off: what makes a fact sensitive, owner-only or unreviewed. */
const PROTECTING: readonly string[] = [...SENSITIVE_TAGS, ...OWNER_ONLY_TAGS, IMPORTED_TAG];

/** The starting confidence of a source (MEMORY.md §4); an imported guess starts at 0.6. */
function base(source: FactSource, tags: string[]): number {
  return source === 'inferred' && tags.includes(IMPORTED_TAG) ? CONFIDENCE.imported : FACT_SOURCES[source].base;
}

interface Flags {
  tags: string[];
  sensitivity: 0 | 1;
  may_raise: 0 | 1;
}

/** A version's tags and flags. The owner's word is final; the mind's only ever adds protection:
 * protecting tags stay, sensitivity only rises (a sensitive tag or a fact about a person makes it
 * 1), and "may raise" only falls (faith is never raised, nor a sensitive guess, M14). */
function flags(
  ctx: OpContext,
  about: string,
  source: FactSource,
  given: { tags?: string[]; sensitivity?: 0 | 1; may_raise?: boolean },
  old: store.FactRow | null,
): Flags {
  const oldTags = old ? store.strings(old.tags_json) : [];
  const asked = [...new Set(given.tags ?? oldTags)];
  const tags = ctx.device ? asked : [...new Set([...asked, ...oldTags.filter((t) => PROTECTING.includes(t))])];
  const implied = has(tags, SENSITIVE_TAGS) || about === 'person' ? 1 : 0;
  const askedSens = given.sensitivity ?? (old?.sensitivity === 1 ? 1 : 0);
  const sensitivity = ctx.device
    ? (given.sensitivity ?? (implied || askedSens ? 1 : 0))
    : Math.max(askedSens, implied, old?.sensitivity ?? 0) === 1
      ? 1
      : 0;
  const was = old ? old.may_raise === 1 : !has(tags, OWNER_ONLY_TAGS);
  const quiet = has(tags, OWNER_ONLY_TAGS) || sensitiveGuess(source, tags, sensitivity as 0 | 1);
  const may = ctx.device ? (given.may_raise ?? was) : was && given.may_raise !== false && !quiet;
  return { tags, sensitivity: sensitivity as 0 | 1, may_raise: may ? 1 : 0 };
}

/** The checks every new version passes: content rules (M11c among them), evidence, a fresh id. */
function admit(ctx: OpContext, f: FactShape, id: string, given: string[] | undefined): string[] {
  content(ctx, f);
  const refs = evidence(ctx, given, f.source);
  // A forgotten id is never used again (its tombstone stays).
  if (store.fact(ctx.db, id) || store.forgotten(ctx.db, id)) throw new Reject('duplicate_id');
  return refs;
}

function writtenBy(c: Caller): string {
  return c.who === 'D' ? 'owner' : (c.session_id ?? c.actor);
}

/** The ledger's own mark: a mind session that read outside text wrote the row. */
const outsideRead = (ctx: OpContext) => ctx.tainted && !ctx.device;

function insert(w: Writer, ctx: OpContext, f: store.NewFact): void {
  store.insertFact(w.db, { ...f, ledger_id: ctx.selfLedger });
  w.change('fact', short(f.id));
}

type Add = Extract<ParsedOp, { op: 'add' }>;

export function add(w: Writer, c: Caller, ctx: OpContext, op: Add): Applied {
  const source: FactSource = ctx.device ? 'user' : op.source;
  if (ctx.device && op.source !== 'user') throw new Reject('bad_op');
  const about = op.about ?? 'owner';
  const f = flags(ctx, about, source, op, null);
  const provenance = label(ctx, source, null);
  const shape: FactShape = { kind: op.kind, source, about, tags: f.tags, sensitivity: f.sensitivity, provenance };
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
    tainted: outsideRead(ctx),
  });
  insert(w, ctx, {
    id: op.id,
    kind: op.kind,
    about: about as store.NewFact['about'],
    subject: op.subject ?? null,
    text: op.text,
    tags_json: f.tags.length ? JSON.stringify(f.tags) : null,
    source,
    confidence: Math.min(FACT_SOURCES[source].cap, base(source, f.tags)),
    evidence_json: JSON.stringify(refs),
    valid_from: op.valid_from ?? null,
    valid_to: null,
    recorded_at: w.at,
    superseded_at: null,
    superseded_by: null,
    last_confirmed: w.at,
    sensitivity: f.sensitivity,
    pinned: 0,
    may_raise: f.may_raise,
    written_by: writtenBy(c),
    ledger_id: ledgerId,
    lineage_id: op.id,
    provenance,
  });
  return { fact_id: op.id, ledger_id: ledgerId, provenance };
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
  const old = current(ctx, op.id);
  const n = op.new;
  if (ctx.device && n.source !== undefined && n.source !== 'user') throw new Reject('bad_op');
  // M12 covers the rule being replaced too, not only a rule being written.
  if (old.kind === 'rule' && ctx.lawsBroken && !ctx.device) throw new Reject('laws_unpinned');
  const source: FactSource = ctx.device ? 'user' : (n.source ?? old.source);
  const provenance = label(ctx, source, old);
  // M11c: outside text never replaces a rule (nor becomes one: content(), in admit).
  if (old.kind === 'rule' && provenance === 'outside') throw new Reject('outside_rule');
  const about = n.about ?? old.about;
  const f = flags(ctx, about, source, n, old);
  const shape: FactShape = {
    kind: n.kind ?? old.kind,
    source,
    about,
    tags: f.tags,
    sensitivity: f.sensitivity,
    provenance,
  };
  const refs = admit(ctx, shape, n.id, n.evidence);
  if (old.source === 'user' && source !== 'user') throw new Reject('proposal_required'); // M9
  noDisplace(old, provenance); // M11c
  const ledgerId = w.ledger({
    id: ctx.selfLedger,
    kind: 'memory',
    actor: c.actor,
    session_id: c.session_id,
    what: `updated a ${shape.kind}`,
    why: why ?? op.reason ?? (ctx.device ? 'the owner fixed it on the Memory page' : cites(refs)),
    ref: short(n.id),
    undo: { op: 'memory.reopen', args: { old_id: old.id, new_id: n.id, valid_to: old.valid_to } },
    tainted: outsideRead(ctx),
  });
  store.closeFact(w.db, old.id, w.at, n.id, n.valid_from ?? null);
  w.change('fact', short(old.id));
  insert(w, ctx, {
    id: n.id,
    kind: shape.kind as store.NewFact['kind'],
    about: about as store.NewFact['about'],
    subject: n.subject ?? old.subject,
    text: n.text,
    tags_json: f.tags.length ? JSON.stringify(f.tags) : null,
    source,
    confidence: Math.min(FACT_SOURCES[source].cap, base(source, f.tags)),
    evidence_json: JSON.stringify(refs),
    valid_from: n.valid_from ?? old.valid_from,
    valid_to: null,
    recorded_at: w.at,
    superseded_at: null,
    superseded_by: null,
    last_confirmed: w.at,
    sensitivity: f.sensitivity,
    pinned: old.pinned,
    may_raise: f.may_raise,
    written_by: writtenBy(c),
    ledger_id: ledgerId,
    lineage_id: old.lineage_id,
    provenance,
  });
  return { fact_id: n.id, ledger_id: ledgerId, provenance };
}

type Confirm = Extract<ParsedOp, { op: 'confirm' }>;

/** Still true: confidence up to its source's base and the decay clock reset. A fact that was not
 * `user` becomes a `user` version when the owner says so: their tap ("Yes, that's right"), or,
 * from the mind, the owner's own words written after the fact was. An older message can't lift
 * it; whether the words really state it is the weekly in-session review's check. An `outside` fact
 * is lifted only by the owner's tap (M11e: Keep, under "Learned from outside"), into an `owner`
 * version; the mind's confirm of one, and any confirm from a session that read outside text, only
 * refreshes it in place and keeps its label. */
export function confirm(w: Writer, c: Caller, ctx: OpContext, op: Confirm): Applied {
  const f = current(ctx, op.id);
  const was = store.provenanceOf(f);
  let ownerWords = true;
  let refs: string[];
  try {
    refs = evidence(ctx, op.evidence, 'user');
  } catch (e) {
    if (!(e instanceof Reject) || e.reason !== 'not_owner_evidence') throw e;
    ownerWords = false;
    refs = evidence(ctx, op.evidence, 'inferred');
  }
  const lifts =
    ownerWords &&
    (ctx.device
      ? f.source !== 'user' || was === 'outside'
      : f.source !== 'user' && !ctx.tainted && was !== 'outside' && (newestOwnerWords(ctx, refs) ?? 0) > f.recorded_at);
  if (lifts) {
    const tags = store.strings(f.tags_json);
    const lift: Supersede = {
      op: 'supersede',
      id: f.id,
      new: {
        id: uuidv7(w.at),
        text: f.text,
        evidence: refs,
        source: 'user',
        tags: ctx.device ? tags.filter((t) => t !== IMPORTED_TAG) : tags,
      },
    };
    const said = was === 'outside' ? 'the owner kept it' : 'the owner said it is right';
    return supersede(w, c, ctx, lift, ctx.device ? said : `confirmed ${cites(refs)}`);
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
    tainted: outsideRead(ctx),
  });
  store.confirmFact(w.db, f.id, confidence, w.at);
  w.change('fact', short(f.id));
  return { fact_id: f.id, ledger_id: ledgerId, provenance: was };
}
