// From the verified principal to the Core's Caller, and the canonical body hash that makes
// `PUT …/:id` idempotent (API.md §7: SHA-256 of the JSON with sorted keys and no whitespace).
import type { Context } from 'hono';
import type { Actor } from '../../../shared/contract/api';
import { sha256Hex } from '../areas/auth/crypto';
import type { Caller } from '../objects/caller';
import { type AppEnv, principalOf, whoOf } from './auth';
import { ApiError } from './errors';

const ACTOR: Record<string, Actor> = {
  D: 'owner',
  C: 'mind:chat',
  N: 'mind:night',
  R: 'mind:reflex',
  M: 'muse',
  I: 'ci',
};
const SESSION = /^[A-Za-z0-9_.:-]{1,120}$/;

export function callerOf(c: Context<AppEnv>): Caller {
  const p = principalOf(c);
  const who = whoOf(p);
  if (p.kind === 'device') return { actor: 'owner', who, session_id: p.session_id, device_id: p.session_id };
  const s = c.req.header('TH-Session') ?? null;
  if (s !== null && !SESSION.test(s)) throw new ApiError('bad_request');
  return { actor: ACTOR[who], who, session_id: s, device_id: null };
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    );
  return v;
}

export function reqHash(body: unknown): string {
  return sha256Hex(JSON.stringify(canonical(body)));
}

/** A path id that must be a lowercase UUIDv7 (API.md §2). */
export function idParam(c: Context<AppEnv>, name = 'id'): string {
  const id = c.req.param(name) ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))
    throw new ApiError('validation', [{ path: name, issue: 'a lowercase UUIDv7' }]);
  return id;
}
