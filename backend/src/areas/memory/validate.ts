// Memory's provenance and taint rules, enforced by the Worker (MEMORY.md §6, M1–M14), each a
// small function with its own test. A broken rule throws `Reject` with its reason; the batch
// lists it and applies the other ops (API.md §11.13). M1 (origin from the principal) is how
// messages are written; M8–M10 route to the owner and wait for proposals (P4), so they reject
// with `proposal_required`; M13's one-claim half is the weekly in-session review.
import * as z from 'zod/mini';
import {
  FACT_ABOUT,
  FACT_KIND_NAMES,
  type FactSource,
  MEMORY_LIMITS,
  type MemoryReason,
  neverStored,
  OWNER_ONLY_TAGS,
  SENSITIVE_TAGS,
} from '../../../../shared/contract/memory.ts';
import type { Db } from '../../objects/base';
import { messageOrigin } from '../conversation/store';
import { byId as ledgerRow } from '../ledger/store';
import { taintedAt } from '../mind/guards';
import { dayNote } from './notes';

export class Reject extends Error {
  constructor(readonly reason: MemoryReason) {
    super(reason);
  }
}

/** Who is writing, as the rules need it. `selfLedger` is the op's own ledger id: from a device
 * an op without evidence cites it (MEMORY.md §12). */
export interface OpContext {
  db: Db;
  at: number;
  device: boolean;
  tainted: boolean;
  /** M12: the session's constitution file was missing (its pin cannot hold). */
  lawsBroken: boolean;
  selfLedger: string;
}

const id = z.string().check(z.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/));
const ref = z.string().check(z.maxLength(240));
const refs = z.array(ref).check(z.maxLength(40));
const text = z.string().check(z.minLength(1), z.maxLength(4_000));
const tag = z.string().check(z.regex(/^[a-z][a-z0-9_-]{0,23}$/));
const fields = {
  kind: z.enum(FACT_KIND_NAMES),
  subject: z.optional(z.string().check(z.minLength(1), z.maxLength(64))),
  source: z.enum(['user', 'observed', 'inferred']),
  about: z.optional(z.enum(FACT_ABOUT)),
  tags: z.optional(z.array(tag).check(z.maxLength(MEMORY_LIMITS.tags_max))),
  valid_from: z.optional(z.number().check(z.int(), z.gte(0))),
  sensitivity: z.optional(z.union([z.literal(0), z.literal(1)])),
  may_raise: z.optional(z.boolean()),
};

export const OP_SCHEMAS = {
  add: z.strictObject({ op: z.literal('add'), id, text, evidence: refs, ...fields }),
  confirm: z.strictObject({ op: z.literal('confirm'), id, evidence: z.optional(refs) }),
  supersede: z.strictObject({
    op: z.literal('supersede'),
    id,
    reason: z.optional(z.string().check(z.minLength(1), z.maxLength(140))),
    new: z.strictObject({
      id,
      text,
      evidence: refs,
      kind: z.optional(fields.kind),
      source: z.optional(fields.source),
      subject: fields.subject,
      about: fields.about,
      tags: fields.tags,
      valid_from: fields.valid_from,
      sensitivity: fields.sensitivity,
      may_raise: fields.may_raise,
    }),
  }),
  pin: z.strictObject({ op: z.literal('pin'), id, pinned: z.boolean() }),
  may_raise: z.strictObject({ op: z.literal('may_raise'), id, value: z.boolean() }),
  forget: z.strictObject({ op: z.literal('forget'), id }),
};
export type OpName = keyof typeof OP_SCHEMAS;
export type ParsedOp = { [K in OpName]: z.output<(typeof OP_SCHEMAS)[K]> }[OpName];

/** One op's shape; anything else is `bad_op`. Text is one line (so no fact can fake a briefing
 * section marker) and M13 caps it at 280 characters. */
export function parseOp(raw: unknown): ParsedOp {
  const name = (raw as { op?: unknown } | null)?.op;
  if (typeof name !== 'string' || !Object.hasOwn(OP_SCHEMAS, name)) throw new Reject('bad_op');
  const out = OP_SCHEMAS[name as OpName].safeParse(raw);
  if (!out.success) throw new Reject('bad_op');
  const op = out.data as ParsedOp;
  if (op.op === 'add') op.text = claim(op.text);
  if (op.op === 'supersede') op.new.text = claim(op.new.text);
  return op;
}

/** Whitespace folded to single spaces; other control characters refused; ≤ 280 (M13); nothing
 * MEMORY.md §13 says is never stored (keys, tokens, card or bank numbers, passwords). */
export function claim(t: string): string {
  const one = t.replace(/\s+/g, ' ').trim();
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
  if (!one || /[\u0000-\u001f\u007f]/.test(one)) throw new Reject('bad_op');
  if (one.length > MEMORY_LIMITS.fact_text) throw new Reject('too_long');
  if (neverStored(one)) throw new Reject('never_stored');
  return one;
}

const REF = /^([a-z][a-z0-9]{1,15}):([A-Za-z0-9._:/-]{1,160})(#[A-Za-z0-9._:-]{1,64})?$/;

interface Cited {
  ref: string;
  /** When a cited message was written (null for other refs). */
  at: number | null;
  /** The owner's own words: an owner-device or imported owner message, or an owner ledger row
   * from a device op. */
  owner: boolean;
  /** A message (or the device's own ledger row), the kind M3 needs at least one of. */
  words: boolean;
  event: boolean;
}

/** M2 and M6: every cited id exists (else `bad_evidence`), is a kind memory may cite, and is not
 * Muse or outside text. `unknown_ref` is kept for the fact an op names. */
function cite(ctx: OpContext, r: string): Cited {
  const m = REF.exec(r);
  if (!m) throw new Reject('bad_evidence');
  const [, kind, key] = m;
  if (kind === 'msg') {
    const msg = messageOrigin(ctx.db, key);
    if (!msg) throw new Reject('bad_evidence');
    if (msg.author === 'muse' || msg.origin === 'muse') throw new Reject('tainted_evidence');
    const owner = msg.author === 'owner' && (msg.origin === 'owner_device' || msg.origin === 'import');
    return { ref: r, at: msg.created_at, owner, words: owner, event: false };
  }
  if (kind === 'day') {
    const note = dayNote(ctx.db, key);
    if (!note) throw new Reject('bad_evidence');
    // A note from a session that was tainted when it wrote it carries outside text (M6).
    const taint = note.written_by === 'owner' ? null : taintedAt(ctx.db, note.written_by);
    if (taint !== null && taint <= note.written_at) throw new Reject('tainted_evidence');
    return { ref: r, at: null, owner: false, words: false, event: false };
  }
  if (kind === 'ledger') {
    if (!ctx.device) throw new Reject('bad_evidence');
    if (key === ctx.selfLedger) return { ref: r, at: ctx.at, owner: true, words: true, event: false };
    const row = ledgerRow(ctx.db, key);
    if (!row) throw new Reject('bad_evidence');
    return { ref: r, at: null, owner: row.actor === 'owner', words: row.actor === 'owner', event: false };
  }
  // Events have no table before Senses (P5) and import items none before the import (P3 stage
  // D): neither can be checked yet, so neither is accepted.
  throw new Reject('bad_evidence');
}

/** The newest of the owner's own messages among checked refs (null: none). */
export function newestOwnerWords(ctx: OpContext, refs: string[]): number | null {
  let newest: number | null = null;
  for (const r of refs) {
    if (!r.startsWith('msg:')) continue;
    const c = cite(ctx, r);
    if (c.owner && c.at !== null && (newest === null || c.at > newest)) newest = c.at;
  }
  return newest;
}

/** The evidence of one op, checked against its source (M2, M3, M5, M6). From a device, no
 * evidence means the op's own ledger row. Returns the refs to store. */
export function evidence(ctx: OpContext, given: string[] | undefined, source: FactSource): string[] {
  let list = [...new Set((given ?? []).map((r) => r.trim()).filter(Boolean))];
  if (!list.length && ctx.device) list = [`ledger:${ctx.selfLedger}`];
  if (list.length < 1 || list.length > MEMORY_LIMITS.evidence_max) throw new Reject('bad_evidence');
  const cited = list.map((r) => cite(ctx, r));
  if (source === 'user' && !(cited.every((c) => c.owner) && cited.some((c) => c.words)))
    throw new Reject('not_owner_evidence');
  if (source === 'observed' && cited.filter((c) => c.event).length < 10) throw new Reject('too_little_evidence');
  // M2 / MEMORY.md §4: an inferred fact rests on the owner's words, day notes or imports, never
  // on the mind's or the system's own messages.
  if (source === 'inferred' && cited.some((c) => c.ref.startsWith('msg:') && !c.owner))
    throw new Reject('bad_evidence');
  return list;
}

export interface FactShape {
  kind: string;
  source: FactSource;
  about: string;
  tags: string[];
  sensitivity: 0 | 1;
}

/** The content rules: M4 and M12 for rules, M7 for faith and people, M14 for sensitive traits. */
export function content(ctx: OpContext, f: FactShape): void {
  if (f.kind === 'rule' && f.source !== 'user') throw new Reject('rule_needs_owner');
  if (f.kind === 'rule' && ctx.lawsBroken && !ctx.device) throw new Reject('laws_unpinned');
  const ownerOnly = f.about === 'person' || f.tags.some((t) => (OWNER_ONLY_TAGS as readonly string[]).includes(t));
  if (ownerOnly && f.source !== 'user') throw new Reject('needs_owner_words');
  if (f.source === 'inferred' && f.tags.some((t) => (SENSITIVE_TAGS as readonly string[]).includes(t)))
    throw new Reject('no_inferred_sensitive');
}

/** M11: a tainted session may not remember, confirm or supersede (enforced from P3, when memory
 * writes arrive). */
export function clean(ctx: OpContext): void {
  if (ctx.tainted && !ctx.device) throw new Reject('session_tainted');
}

/** pin, may_raise and forget are the owner's alone. */
export function owner(ctx: OpContext): void {
  if (!ctx.device) throw new Reject('device_only');
}

/** M8: a new inferred fact with sensitivity 1 goes to the owner (P4's proposals; refused now). */
export function askFirst(f: FactShape): void {
  if (f.source === 'inferred' && f.sensitivity === 1) throw new Reject('proposal_required');
}
