// Helpers for recall by meaning (search/semantic.ts, search/embed-job.ts). The AI binding is a
// fake, passed in an env of the test's own as the files suites pass theirs: its "model" puts words
// of one meaning (a small invented thesaurus) on one dimension and every other word on a hashed one
// with a small weight, so two wordings of one thing land near each other and unrelated ones don't.
// It stands in for the embedding model's job, not its quality. All text here is invented.
import { createExecutionContext, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { app } from '../src/app';
import { runJobs } from '../src/areas/jobs/runner';
import { EMBED_JOB, embedJob, queueEmbed } from '../src/areas/search/embed-job';
import type { Db } from '../src/objects/base';
import type { Writer } from '../src/objects/commit';
import type { Core } from '../src/objects/core';
import { core } from './helpers';

/** Words of one meaning, by prefix (so "recorded" is "record"). */
export const MEANINGS: string[][] = [
  ['record', 'memo', 'voice', 'tape', 'audio', 'dictat'],
  ['guitar', 'chord', 'fret', 'strum', 'string'],
  ['bike', 'cycl', 'pedal', 'ride'],
  ['bread', 'bak', 'dough', 'loaf', 'oven'],
  ['garden', 'tomato', 'seed', 'plant', 'soil'],
  ['sleep', 'tired', 'nap', 'rest', 'bed'],
  ['run', 'jog', 'sprint', 'race', 'marathon'],
  ['money', 'budget', 'sav', 'spen', 'cost'],
  ['rain', 'storm', 'umbrella', 'weather', 'wet'],
  ['car', 'engine', 'mechanic', 'tyre', 'brake'],
  ['piano', 'keys', 'scale', 'practi'],
  ['sister', 'brother', 'cousin', 'family'],
  ['book', 'novel', 'chapter', 'read'],
  ['coffee', 'espresso', 'brew', 'caf'],
  ['dog', 'puppy', 'walk', 'leash'],
  ['paint', 'canvas', 'brush', 'colour'],
  ['phone', 'screen', 'battery', 'charger'],
  ['trip', 'travel', 'flight', 'airport', 'holiday'],
  ['doctor', 'appointment', 'clinic', 'checkup'],
  ['birthday', 'gift', 'party', 'present'],
];

const DIMS = 384;
const hash = (w: string) => [...w].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export function fakeVector(text: string): number[] {
  const v = new Array<number>(DIMS).fill(0);
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const m = MEANINGS.findIndex((ws) => ws.some((p) => w.startsWith(p)));
    if (m >= 0) v[m] += 1;
    else v[MEANINGS.length + (hash(w) % (DIMS - MEANINGS.length))] += 0.2;
  }
  if (Math.max(...v) === 0) v[DIMS - 1] = 1;
  return v;
}

export interface FakeAi {
  calls: { model: string; texts: string[] }[];
  env: Env;
}

/** A fake AI binding; `fail` makes every call throw (a refusal, or a day over the quota). */
export function fakeAi(fail = false): FakeAi {
  const calls: FakeAi['calls'] = [];
  const AI = {
    async run(model: string, inputs: Record<string, unknown>) {
      const texts = inputs.text as string[];
      calls.push({ model, texts });
      if (fail) throw new Error('3036: daily free allocation used up');
      return { shape: [texts.length, DIMS], data: texts.map(fakeVector) };
    },
  };
  return { calls, env: { ...env, AI } as unknown as Env };
}

type Host = { db: Db; write<T>(fn: (w: Writer) => T, at?: number): T };

/** Queues the indexer and runs Core's jobs (this suite's Core has no others) until none is due,
 * with `e` as the job's env. Returns the steps run. */
export function runIndexer(e: Env, now = Date.now()): Promise<number> {
  return runInDurableObject(core() as unknown as DurableObjectStub<Core>, async (o: Core) => {
    const c = o as unknown as Host;
    c.write((w) => queueEmbed(w.db, w.at), now);
    let steps = 0;
    for (let i = 0; i < 50; i++) {
      const n = await runJobs({ env: e, db: c.db, write: (fn, at) => c.write(fn, at) }, { [EMBED_JOB]: embedJob }, now);
      steps += n;
      if (!n) break;
    }
    return steps;
  });
}

/** GET /v1/search through the app with `e` (the fake AI's env). */
export async function searchWith<T>(e: Env, token: string, query: string, headers: Record<string, string> = {}) {
  const req = new Request(`https://api.example.test/v1/search?${query}`, {
    headers: { Authorization: `Bearer ${token}`, 'CF-Connecting-IP': '192.0.2.10', ...headers },
  });
  const res = await app.fetch(req, e, createExecutionContext());
  return { status: res.status, body: (await res.json()) as T };
}
