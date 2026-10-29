// Output, errors and exit codes for `th` (RUNTIME.md §5.1–5.2).
// Success: one line of compact JSON on stdout. Failure: {"error":{code,message,request_id}} on stderr.
import {readFileSync} from 'node:fs';

export const VERSION = '0.2.0';

/** RUNTIME.md §5.2. */
export const EXIT = Object.freeze({
  ok: 0, unexpected: 1, unauthorized: 2, timeout: 3, stop: 4, day_closed: 5, forbidden: 6,
  conflict: 7, validation: 8, unreachable: 9, budget: 10, already_live: 11,
});

export class ThError extends Error {
  /** @param {number} exit @param {string} code @param {string} message @param {string|null} [requestId]
   * @param {unknown} [details] the Worker's field issues or reason (never request values), e.g. why a memory op was refused */
  constructor(exit, code, message, requestId = null, details = undefined) {
    super(message);
    this.exit = exit;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}

/** A usage or local validation error (exit 8). */
export const invalid = message => new ThError(EXIT.validation, 'validation', message);

/** Maps an HTTP error response to an exit code. 5xx and network errors are handled by the retry loop. */
export function exitFor(status, code) {
  if (status === 401) return EXIT.unauthorized;
  if (status === 403) return EXIT.forbidden;
  if (status === 409 && code === 'already_live') return EXIT.already_live;
  if (status === 409 || status === 410 || status === 426) return EXIT.conflict;
  if (status === 400 || status === 404 || status === 413 || status === 415 || status === 422) return EXIT.validation;
  if (status === 429 || (status === 503 && code === 'budget_exhausted')) return EXIT.budget;
  if (status >= 500) return EXIT.unreachable;
  return EXIT.unexpected;
}

// Anything token-shaped is removed from everything th prints, as a second line of defence:
// th never reads the token into a message, but a Worker error could echo a header back.
const TOKEN_SHAPES = [/\b(th1|thm|ths|thc|tha|thw)_[A-Za-z0-9_-]{16,}/g, /Bearer\s+[^\s"',;]+/gi];
export function redact(text, env = process.env) {
  let out = String(text);
  if (env.TH_TOKEN && env.TH_TOKEN.length >= 8) out = out.split(env.TH_TOKEN).join('[redacted]');
  for (const shape of TOKEN_SHAPES) out = out.replace(shape, '[redacted]');
  return out;
}

export function out(value) {
  process.stdout.write(redact(typeof value === 'string' ? value : JSON.stringify(value)) + '\n');
}

export function printError(error) {
  const e = error instanceof ThError ? error
    : new ThError(EXIT.unexpected, 'unexpected', error?.message || String(error));
  const details = Array.isArray(e.details) ? e.details.slice(0, 50) : e.details && typeof e.details === 'object' ? e.details : undefined;
  process.stderr.write(redact(JSON.stringify({error: {code: e.code, message: e.message, request_id: e.requestId, details}})) + '\n');
  return e.exit;
}

/** `-` means stdin; otherwise the words joined. */
export function textArg(words) {
  if (words.length === 1 && words[0] === '-') return readFileSync(0, 'utf8').replace(/\n$/, '');
  return words.join(' ');
}

/** Parses a --flag that must be JSON. */
export function jsonFlag(value, name) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw invalid(`--${name} needs a JSON value`);
  try { return JSON.parse(value); } catch { throw invalid(`--${name} is not valid JSON`); }
}

/** A string flag that must be present. */
export function need(flags, name) {
  const value = flags[name];
  if (typeof value !== 'string' || value === '') throw invalid(`--${name} is required`);
  return value;
}

/** Comma-separated list flag (evidence ids, paths). */
export const list = value => typeof value === 'string' ? value.split(',').map(s => s.trim()).filter(Boolean) : [];

/** ISO date/time or ms → ms. */
export function toMs(value, name) {
  if (value === undefined) return undefined;
  const n = /^\d+$/.test(String(value)) ? Number(value) : Date.parse(String(value));
  if (!Number.isFinite(n)) throw invalid(`--${name} is not a date`);
  return n;
}
