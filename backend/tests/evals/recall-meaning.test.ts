// The recall-by-meaning eval (EVALS.md §3.4), the smallest honest version: 20 invented things the
// owner said, and for each a question in other words. Every question must find its sentence in the
// top 3 of GET /v1/search, and FTS alone must not (so it is found by meaning, not by a shared
// word). The model is the suite's fake (recall-helpers.ts: one dimension per meaning), since tests
// never reach Workers AI: this proves the path (index, cosine, the live check, fusion), not the
// real model's quality, which only a run against the live Worker can show.
import { beforeAll, describe, expect, it } from 'vitest';
import type { SearchResponse } from '../../../shared/contract/api';
import { ownerSays, type Principals, principals } from '../memory-helpers';
import { fakeAi, runIndexer, searchWith } from '../recall-helpers';

const CASES: [said: string, asked: string][] = [
  ['Left the voice memo from the lake on the old tablet.', 'that thing I said about the recording'],
  ['Changed the old acoustic and the strings already buzz.', 'guitar fret trouble'],
  ['Pedalled to the market and back before noon.', 'the bike ride'],
  ['The sourdough loaf came out flat again.', 'baking bread'],
  ['Planted tomatoes along the south fence.', 'what did I put in the garden soil'],
  ['Felt exhausted and napped most of the afternoon.', 'sleep and being tired'],
  ['Jogged five kilometres by the canal.', 'my running'],
  ['Spent too much at the hardware shop this month.', 'money and the budget'],
  ['Got soaked on the way home without an umbrella.', 'the stormy weather'],
  ['The mechanic says the brakes squeal because the pads are worn.', 'car engine repair'],
  ['Practised scales for twenty minutes before dinner.', 'piano keys'],
  ['My cousin is visiting next weekend.', 'family coming over'],
  ['Finished the novel about the lighthouse keeper.', 'that book chapter'],
  ['Switched to a darker espresso roast.', 'coffee brew'],
  ['The puppy pulled on the leash all morning.', 'the dog walk'],
  ['Started a canvas of the harbour at dusk.', 'painting with a brush'],
  ['The battery dies by lunchtime now.', 'phone screen problems'],
  ['Got seats on the flight to the coast for August.', 'travel holiday plans'],
  ['The clinic moved my checkup to Thursday.', 'doctor appointment'],
  ['Wrapped the gift for the party on Sunday.', 'birthday present'],
];

let P = {} as Principals;
const ids: string[] = [];

beforeAll(async () => {
  P = await principals();
  for (const [said] of CASES) ids.push(await ownerSays(P.D, said));
  await runIndexer(fakeAi().env);
});

describe('EVALS.md §3.4: recall by meaning', () => {
  it('each question in other words finds what was said in the top 3, where FTS alone does not', async () => {
    let found = 0;
    for (const [i, [, asked]] of CASES.entries()) {
      const q = `q=${encodeURIComponent(asked)}`;
      const top = (await searchWith<SearchResponse>(fakeAi().env, P.D, q)).body.items.slice(0, 3);
      if (top.some((h) => h.ref === `msg:${ids[i]}`)) found++;
      const words = (await searchWith<SearchResponse>(fakeAi(true).env, P.D, q)).body.items;
      expect(
        words.map((h) => h.ref),
        asked,
      ).not.toContain(`msg:${ids[i]}`);
    }
    expect(found).toBe(CASES.length);
  });
});
