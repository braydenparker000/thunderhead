// The listening-history import (MUSIC.md §16.1, JOBS.md §4.4 `music.history`), a bulk-lane job in
// Core's alarm. Its first step reads the file the owner dropped from the private bucket, sums it
// (history-read.ts) and keeps the summary as parts of 2,000 rows beside it; each later step puts one
// part in the Music object, which adds a part to the counts only when it is the file's next, so a
// retried step writes nothing twice and a file already imported (by its SHA-256) is never counted
// again. Its end: the brief's taste line, a ledger note with counts only, and the MusicBrainz job.
import { TASTE_LIMITS as L, type TasteResponse, type TasteSource } from '../../../../shared/contract/taste.ts';
import type { Writer } from '../../objects/commit';
import { musicObject } from '../../objects/music';
import { JobError, type JobHandler } from '../jobs/runner';
import { requeueJob } from '../jobs/store';
import { putSetting } from '../settings/store';
import type { SummaryRow } from './history-parse';
import { partsOf, readExport } from './history-read';

export const HISTORY_JOB = 'music.history';
export const MB_JOB = 'music.mb';
export const historyKey = (sha: string) => `music/history/${sha}`;
const partKey = (sha: string, n: number) => `music/history/${sha}.part-${n}.json`;

export interface HistoryPayload {
  sha256: string;
  name: string;
}
type Cursor = { part: number } | null;
type Input =
  | { split: { parts: number; source: TasteSource; rows: number } }
  | { put: { written: number; done: boolean }; taste?: TasteResponse };

const vaultOf = (env: Env): R2Bucket => {
  const v = (env as { VAULT?: R2Bucket }).VAULT;
  if (!v) throw new JobError('not_configured');
  return v;
};

/** The brief's one line of taste (section 1): counts, and at most the top three artists by their
 * canonical names, never a name as a file spelled it. */
export function tasteLine(t: TasteResponse): string | null {
  if (!t.plays) return null;
  const years = [...t.years].sort((a, b) => a.year - b.year);
  const span = years.length ? ` ${years[0].year}–${years.at(-1)?.year}, most in ${t.years[0].year};` : '';
  const named = t.top.slice(0, 3).flatMap((a) => (a.name ? [a.name] : []));
  const top = named.length ? ` top: ${named.join(', ')}` : ' top artists not resolved yet';
  return `taste: ${t.plays} plays of ${t.artists} artists,${span}${top} (th music taste)`;
}

export function putTaste(w: Writer, t: TasteResponse | undefined): void {
  if (t) putSetting(w.db, 'music.taste', tasteLine(t), 'worker', w.at);
}

export const historyJob: JobHandler = {
  kind: HISTORY_JOB,
  lane: true,
  maxAttempts: 3,
  async load(env, _db, payload, cursor) {
    const p = payload as HistoryPayload;
    const vault = vaultOf(env);
    const music = musicObject(env);
    const c = cursor as Cursor;
    if (!c) {
      const obj = await vault.get(historyKey(p.sha256));
      if (!obj) throw new JobError('missing_file');
      const read = await readExport(p.name, new Uint8Array(await obj.arrayBuffer()));
      if (!read) throw new JobError('not_history');
      const parts = partsOf(read.rows, L.part_rows);
      for (const [i, rows] of parts.entries()) await vault.put(partKey(p.sha256, i + 1), JSON.stringify(rows));
      await music.startHistory({
        sha256: p.sha256,
        source: read.source,
        parts: parts.length,
        rows: read.rows.length,
        skipped: read.skipped,
        at: Date.now(),
      });
      return { split: { parts: parts.length, source: read.source, rows: read.rows.length } } satisfies Input;
    }
    const obj = await vault.get(partKey(p.sha256, c.part));
    if (!obj) throw new JobError('missing_part');
    const put = await music.putHistoryPart(p.sha256, c.part, (await obj.json()) as SummaryRow[]);
    return { put, taste: put.done ? await music.taste(3) : undefined } satisfies Input;
  },
  step(w, payload, cursor, input) {
    const p = payload as HistoryPayload;
    const i = input as Input;
    if ('split' in i) {
      if (i.split.parts) return { next: { part: 1 } };
      tell(w, p, 'The listening history file held no plays to import.');
      return { done: true };
    }
    const c = cursor as { part: number };
    if (!i.put.done) return { next: { part: c.part + 1 }, rows: i.put.written };
    putTaste(w, i.taste);
    const t = i.taste;
    tell(w, p, `Imported a listening history file: ${t?.plays ?? 0} plays of ${t?.artists ?? 0} artists so far.`);
    requeueJob(w.db, { id: MB_JOB, kind: MB_JOB, payload: {}, at: w.at });
    return { done: true, rows: i.put.written };
  },
  failed(w, payload, code) {
    tell(w, payload as HistoryPayload, `The listening history import stopped (${code}). Nothing was counted twice.`);
  },
};

function tell(w: Writer, p: HistoryPayload, what: string): void {
  w.ledger({
    kind: 'note',
    actor: 'worker',
    what,
    why: `the listening history file ${p.sha256.slice(0, 8)}`,
    undoable: false,
  });
}
