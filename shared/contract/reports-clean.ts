// The cleaning of a report (shared/contract/reports.ts): only a batch's known fields are kept, and
// every text keeps of an address only its host, loses quoted text, `/patterns/` and tokens, and is at
// most `text_max` characters. The Worker runs it on every batch it takes (areas/reports/ops.ts);
// frontend/ui/scrub.js and frontend/th/music/report-fields.js are the phone's copies, and
// tests/music-report.test.mjs checks the two give the same answers.
import type { Json, JsonObject } from './api.ts';
import {
  PLAYBACK_BATCH,
  PLAYBACK_EVENTS,
  PLAYBACK_STATE,
  REPORT_LIMITS,
  type ReportField,
  type ReportKind,
} from './reports.ts';

/** List items kept, at most (a batch's events: the log keeps 300). */
const LIST_MAX = 400;
const ID = /^[A-Za-z0-9_.:#-]{1,140}$/;
const HEX = /^[0-9a-f]{1,32}$/;
const FMT = /^[A-Za-z0-9.+-]{1,12}$/;
// An address: any scheme (HTTPS://, blob:https://, file://, content://, data:…; a word and a colon
// that no space or colon follows), any user and password, and the rest of the text up to a quote or
// a bracket (a path may hold spaces). Only its host stays.
const ADDRESS = /\b((?:[a-z][a-z0-9+.-]*:(?=[^\s:]))+)(?:\/\/(?:[^\s/?#@"'<>()[\]]*@)?([^\s/?#@"'<>()[\]]*))?[^"'<>()[\]]*/gi;
// Quoted text, as browsers quote what was typed ("<text>" cannot be parsed as a URL).
const QUOTED = [/(?<![A-Za-z0-9])"[^"\n]*"/g, /(?<![A-Za-z0-9])'[^'\n]*'(?![A-Za-z0-9])/g, /“[^”\n]*”|‘[^’\n]*’|`[^`\n]*`/g];
// A pattern, as in "Invalid regular expression: /<pattern>/: …".
const PATTERN = /(^|[\s:(])\/(?:\\.|[^/\s\\])(?:\\.|[^/\n\\])*\/[dgimsuvy]*(?=$|[\s:,.)])/g;
const TOKEN = /\b(th1|thm|ths|thc|thw|thfp)_[A-Za-z0-9_-]{8,}/g;

/** Words as kept: an address (percent-encoded too) only its host, quoted text and a `/pattern/`
 * as `…`, no session or key token, at most `max` characters. */
export function cleanText(s: string, max: number = REPORT_LIMITS.text_max): string {
  let out = s.replace(/%([0-9a-f]{2})/gi, (_m, h: string) => String.fromCharCode(Number.parseInt(h, 16)));
  out = out.replace(
    ADDRESS,
    (m: string, scheme: string, host?: string) => (host ? `${host}/…` : `${scheme.split(':')[0]}:…`) + (/\s$/.test(m) ? ' ' : ''),
  );
  for (const q of QUOTED) out = out.replace(q, '…');
  return out.replace(PATTERN, '$1…').replace(TOKEN, '[token]').slice(0, max);
}

/** A value kept as `field` says, or undefined to leave it out. */
export function keepField(field: ReportField, v: unknown): Json | undefined {
  if (typeof field === 'string') {
    if (field === 'n') return typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : undefined;
    if (field === 'b') return typeof v === 'boolean' ? v : undefined;
    if (typeof v !== 'string') return undefined;
    if (field === 'id') return ID.test(v) ? v : undefined;
    if (field === 'hex') return HEX.test(v) ? v : undefined;
    if (field === 'fmt') return FMT.test(v) ? v : undefined;
    if (field === 't') return cleanText(v);
    return field.slice(4).split('|').includes(v) ? v : undefined;
  }
  if (Array.isArray(field)) {
    if (!Array.isArray(v)) return undefined;
    const item = field[0] as ReportField;
    return v
      .slice(-LIST_MAX)
      .map((x) => keepField(item, x))
      .filter((x): x is Json => x !== undefined);
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: JsonObject = {};
  for (const [k, f] of Object.entries(field as Record<string, ReportField>)) {
    const x = keepField(f, (v as Record<string, unknown>)[k]);
    if (x !== undefined) out[k] = x;
  }
  return out;
}

/** One event as kept: its number, time and type, and its type's own fields. */
export function keepEvent(e: unknown): JsonObject {
  const o = e !== null && typeof e === 'object' ? (e as Record<string, unknown>) : {};
  const known = typeof o.type === 'string' && Object.hasOwn(PLAYBACK_EVENTS, o.type);
  const type = known ? (o.type as keyof typeof PLAYBACK_EVENTS) : null;
  return {
    ...(keepField({ n: 'n', t: 'n' }, o) as JsonObject),
    type: type ?? 'other',
    ...(type ? (keepField(PLAYBACK_EVENTS[type], o) as JsonObject) : {}),
  };
}

/** A batch as kept: only the known fields of its kind. */
export function cleanReport(_kind: ReportKind, body: unknown): JsonObject {
  const b = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const out = keepField(PLAYBACK_BATCH, b) as JsonObject;
  if (Array.isArray(b.events)) out.events = b.events.slice(-LIST_MAX).map(keepEvent);
  const state = keepField(PLAYBACK_STATE, b.state);
  if (state !== undefined) out.state = state;
  return out;
}
