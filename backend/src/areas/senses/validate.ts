// One sense event checked (API.md §11.14): a uuidv7 id, a time within the last 30 days and the next
// 5 minutes, a type the contract lists (SENSE_TYPES), a ref of the shared grammar and of a kind the
// type allows, data of at most 2 KB holding only the type's fields, each of its kind, and a
// sensitivity of 0 or 1, never below the type's. A bad event is dropped with its reason; the batch
// still counts.
import {
  SENSE_LIMITS,
  SENSE_TYPE,
  type SenseApp,
  type SenseEvent,
  type SenseField,
  type SenseRejectReason,
  senseType,
} from '../../../../shared/contract/senses.ts';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REF = /^[a-z][a-z0-9]{1,15}:[A-Za-z0-9._:/-]{1,160}(#[A-Za-z0-9._:-]{1,64})?$/;
const KEY = /^[A-Za-z0-9._:/-]{1,160}$/;
const MS_MAX = 7 * 86_400_000;

export interface CheckedEvent {
  id: string;
  at: number;
  type: string;
  app: string;
  ref: string | null;
  data_json: string | null;
  sensitivity: 0 | 1;
  /** Whose privacy switch holds it (SENSE_TYPES). */
  switch: SenseApp;
}

/** Whether one value is of its field's kind (SenseField); null always is. */
function fits(kind: SenseField, v: unknown): boolean {
  if (v === null) return true;
  if (typeof kind !== 'string') return typeof v === 'string' && kind.includes(v);
  switch (kind) {
    case 'id':
      return typeof v === 'string' && KEY.test(v);
    case 'ref':
      return typeof v === 'string' && REF.test(v);
    case 'ids':
      return Array.isArray(v) && v.length <= 50 && v.every((x) => typeof x === 'string' && KEY.test(x));
    case 'ms':
      return Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= MS_MAX;
    case 'int':
      return Number.isSafeInteger(v) && (v as number) >= 0;
    case 'num':
      return typeof v === 'number' && Number.isFinite(v);
    case 'bool':
      return typeof v === 'boolean';
  }
  return false;
}

export function checkEvent(e: SenseEvent, now: number): CheckedEvent | SenseRejectReason {
  if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !ID.test(e.id)) return 'bad_id';
  if (typeof e.type !== 'string' || e.type.length > 80 || !SENSE_TYPE.test(e.type)) return 'bad_type';
  const spec = senseType(e.type);
  if (!spec) return 'bad_type';
  if (!Number.isSafeInteger(e.at) || e.at < now - SENSE_LIMITS.past_ms || e.at > now + SENSE_LIMITS.future_ms)
    return 'bad_time';
  if (e.ref != null && (typeof e.ref !== 'string' || !REF.test(e.ref))) return 'bad_ref';
  if (e.ref != null && !(spec.ref as readonly string[]).includes(e.ref.slice(0, e.ref.indexOf(':')))) return 'bad_ref';
  let data: string | null = null;
  if (e.data != null) {
    if (typeof e.data !== 'object' || Array.isArray(e.data)) return 'bad_data';
    data = JSON.stringify(e.data);
    if (new TextEncoder().encode(data).length > SENSE_LIMITS.data_bytes) return 'too_large';
    for (const [k, v] of Object.entries(e.data))
      if (!Object.hasOwn(spec.data, k) || !fits(spec.data[k], v)) return 'bad_data';
  }
  if (e.sensitivity != null && e.sensitivity !== 0 && e.sensitivity !== 1) return 'bad_type';
  return {
    id: e.id,
    at: e.at,
    type: e.type,
    app: e.type.split('.')[0],
    ref: e.ref ?? null,
    data_json: data,
    // The type's own sensitivity is a floor: the phone may raise it, never lower it.
    sensitivity: e.sensitivity === 1 || spec.sensitivity === 1 ? 1 : 0,
    switch: spec.app,
  };
}

/** What an event adds to its day's rollup: a duration from its data, if it names one. */
export function msOf(dataJson: string | null): number {
  if (!dataJson) return 0;
  const d = JSON.parse(dataJson) as Record<string, unknown>;
  for (const k of ['listened_ms', 'duration_ms', 'ms'])
    if (typeof d[k] === 'number' && Number.isFinite(d[k]) && (d[k] as number) >= 0)
      return Math.min(Math.round(d[k] as number), 86_400_000);
  return 0;
}
