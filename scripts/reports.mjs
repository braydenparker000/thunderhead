#!/usr/bin/env node
// The editor's reports, read from a session the owner gave the Cloudflare account to (frontend/th/report/: each phone
// sends a day's events as `report-<model>-<day>.json` to the workshop, API.md §11.27). Prints each visit of the editor
// as a timeline, phone by phone: when it began, the build, then each event with the seconds since; a heavy job as it
// began and ended (how long, done or left), a reset with what it blamed and the GPU memory held, a visit that died
// with what was running. It only reads.
//
//   node scripts/reports.mjs                     every phone, the last 2 days
//   node scripts/reports.mjs --phone SM-A155F --days 1
//   node scripts/reports.mjs --json <folder>     the files as they came, joined into <folder>
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { account, fetchFile, files } from './workshop.mjs';

/** The words for one event, its fields after its kind. @param {Record<string, any>} e */
export function line(e) {
  const skip = new Set(['s', 'n', 'at', 't', 'kind', 'k']), f = Object.entries(e).filter(([k]) => !skip.has(k)).map(([k, v]) => `${k} ${v}`).join(' · ');
  const say = { begin: `▶ ${e.job}`, end: `■ ${e.job} ${e.outcome || ''} ${e.ms ?? ''} ms`, lost: `✖ RESET (blamed ${e.job || '?'}, ${e.mb ?? '?'} MB held, peak ${e.peakMb ?? '?'}, budget ${e.budgetMb ?? '?'})`, died: `✖ DIED${e.hidden ? ' in the background' : ''} while ${e.job}`, oom: '✖ out of GPU memory' }[e.kind];
  return say || `${e.kind}${f ? ` · ${f}` : ''}`;
}

/** Visits from the files' JSON: each with its phone, session and events in order, the same event sent twice kept once. @param {any[]} docs */
export function visits(docs) {
  const by = /** @type {Map<string, { phone: any, session: any, events: Map<number, any> }>} */ (new Map());
  for (const d of docs) {
    const sess = new Map((d.sessions || []).map((/** @type {any} */ s) => [s.id, s]));
    for (const e of d.events || []) {
      const v = by.get(e.s) || { phone: d.phone, session: sess.get(e.s) || { id: e.s }, events: new Map() };
      if (sess.get(e.s)) v.session = { ...v.session, ...sess.get(e.s) };
      v.events.set(e.n, e); by.set(e.s, v);
    }
  }
  return [...by.values()].map((v) => ({ ...v, events: [...v.events.values()].sort((a, b) => a.n - b.n) })).sort((a, b) => (a.session.at || a.events[0]?.at || 0) - (b.session.at || b.events[0]?.at || 0));
}

/** One visit as text. @param {ReturnType<typeof visits>[number]} v */
export function timeline(v) {
  const s = v.session, start = s.at || v.events[0]?.at || 0, model = v.phone?.model || 'phone';
  const head = `${model} · ${new Date(start).toISOString().replace('T', ' ').slice(0, 19)} UTC · build ${s.build || '?'}${s.died ? ' · DIED' : s.closed ? ' · closed' : ' · open or gone'}`;
  return [head, ...v.events.map((e) => `  ${(((e.at || start) - start) / 1000).toFixed(1).padStart(7)} s  ${line(e)}`)].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (/** @type {string} */ k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : ''; };
  const days = Number(arg('--days')) || 2, phone = arg('--phone'), keep = arg('--json');
  let acct = '', all = /** @type {ReturnType<typeof files>} */ ([]);
  try { acct = account(); all = files(acct); } catch (e) { console.error(`The storage did not answer: ${String(/** @type {Error} */ (e).message).split('\n').at(-2) ?? e}`); process.exit(1); }
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const want = all.filter((f) => { const m = /^report-(.+)-(\d{4}-\d{2}-\d{2})\.json$/.exec(f.name); return m && m[2] >= since && (!phone || m[1] === phone); });
  if (!want.length) { console.log('No editor reports for that.'); process.exit(0); }
  const dir = keep || mkdtempSync(join(tmpdir(), 'th-reports-'));
  try {
    const docs = want.map((f) => JSON.parse(readFileSync(fetchFile(acct, f, join(dir, f.id)), 'utf8')));
    for (const v of visits(docs)) console.log(`${timeline(v)}\n`);
  } finally { if (!keep) rmSync(dir, { recursive: true, force: true }); }
}
