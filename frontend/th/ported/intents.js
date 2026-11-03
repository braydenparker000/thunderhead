// @ts-check
// Pending intents for the ported apps (API.md §11.11 "Pending intents"; `intent` in
// shared/contract/verbs.ts): verbs the mind queued for state that lives in an app (Music's queue and
// ratings, Podcasts' shows and Up Next), which home's own verb loop never takes. The app asks for
// its own as it opens (GET /v1/verbs/pending?app=), claims each one (one another phone took is
// skipped), runs it with its executors and reports the result with its inverse, exactly as home
// reports a device verb, so the ledger row, its Undo and the mind's follow-up work the same. An
// intent this app can't run is reported `unsupported_verb`. Only signed in, and in a top-level page
// or one of home's own frames (th/ported/session.js). `run` and `applyIntents` take their I/O as
// arguments, so the tests drive them without a network.
import { CONFIG } from '../../config.js';
import { framedByOther, sessionToken } from './session.js';

/** @typedef {{ ok: true, result: Record<string, unknown>, undo?: { verb: string, schema: number, args: Record<string, unknown> } } | { ok: false, error: { code: string, message?: string } }} Outcome */
/** @typedef {{ id: string, verb: string, schema: number, args: any, status: string }} Intent */
/** @template T @typedef {Record<string, Record<number, (target: T, args: any) => Promise<Outcome>>>} Executors */
/** @typedef {{ pending: () => Promise<Intent[]>, claim: (id: string) => Promise<boolean>, report: (id: string, out: Outcome) => Promise<void> }} Io */

/** Runs one intent with this app's executors; anything it lacks is `unsupported_verb`.
 * @template T @param {Executors<T>} executors @param {T} target @param {Intent} v @returns {Promise<Outcome>} */
export async function run(executors, target, v) {
  const fn = Object.hasOwn(executors, v.verb) ? executors[v.verb]?.[v.schema] : undefined;
  if (!fn) return { ok: false, error: { code: 'unsupported_verb' } };
  try {
    return await fn(target, v.args ?? {});
  } catch (e) {
    return { ok: false, error: { code: 'failed', message: String(/** @type {Error} */ (e)?.message ?? e).slice(0, 200) } };
  }
}

/** Claims and runs the app's pending intents, oldest first. Returns the outcomes and `send`, which
 * reports them: an app that must write its storage first (Podcasts) sends only once it has.
 * @template T @param {Executors<T>} executors @param {T} target @param {Io} io */
export async function applyIntents(executors, target, io) {
  /** @type {[Intent, Outcome][]} */
  const done = [];
  for (const v of await io.pending()) {
    if (v.status !== 'pending' || !(await io.claim(v.id))) continue;
    done.push([v, await run(executors, target, v)]);
  }
  return {
    done,
    send: async () => {
      for (const [v, out] of done) await io.report(v.id, out);
    },
  };
}

/** A call to the Worker gives up after this long (the next open tries again). */
const CALL_MS = 15_000;

export const deps = {
  /** @type {typeof fetch} */
  fetch: (...a) => fetch(...a),
  api: () => CONFIG.api,
  token: () => (framedByOther() ? Promise.resolve(null) : sessionToken()),
};

/** The Worker's I/O for `app`, signed in; null when signed out or without a Worker.
 * @param {string} app @returns {Promise<Io | null>} */
export async function workerIo(app) {
  const base = deps.api();
  const t = base ? await deps.token() : null;
  if (!t) return null;
  /** @param {string} method @param {string} path @param {unknown} [body] */
  const call = async (method, path, body) => {
    try {
      return await deps.fetch(`${base}/v1/verbs/${path}`, {
        method,
        headers: { Authorization: `Bearer ${t}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'omit',
        mode: 'cors',
        cache: 'no-store',
        signal: AbortSignal.timeout(CALL_MS),
      });
    } catch {
      return null;
    }
  };
  return {
    pending: async () => {
      const r = await call('GET', `pending?app=${encodeURIComponent(app)}`);
      return r?.ok ? /** @type {{ items: Intent[] }} */ (await r.json()).items ?? [] : [];
    },
    claim: async (id) => Boolean((await call('POST', `${encodeURIComponent(id)}/claim`, {}))?.ok),
    report: async (id, out) => {
      await call('POST', `${encodeURIComponent(id)}/result`, out.ok ? { ok: true, result: out.result, undo: out.undo } : { ok: false, error: out.error });
    },
  };
}
