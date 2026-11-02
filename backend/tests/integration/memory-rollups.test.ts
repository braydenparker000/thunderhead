// Rule M5's `rollup:` refs (MEMORY.md §4, §6): an `observed` fact may rest on one routine of the
// senses that counts at least 10 of the owner's events. The memory route has the senses count each
// cited ref again before Core's transaction (areas/memory/rollups.ts); here a stub stands in for the
// Senses object's `routineRef`. A ref it confirms at n ≥ 10 is evidence; a thin or unknown one is
// `bad_evidence`. (Until the senses' routines add `routineRef` to the Senses object, its call
// fails, is caught, and counts nothing: every `rollup:` ref stays `bad_evidence`.)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROLLUPS, type Rollups, rollupRefs, sensesRollups } from '../../src/areas/memory/rollups';
import { addOp, as, labelled, NIGHT_SESSION, ownerSays, type Principals, principals } from '../memory-helpers';

const GOOD = 'rollup:routines/guitar.session/mon.wed/21-22/2026-11-01';
const THIN = 'rollup:routines/guitar.session/sat/9-10/2026-11-01';
const UNKNOWN = 'rollup:routines/music.play/sun/7-8/2026-11-01';

let P = {} as Principals;
const asked: { ref: string; tz: string }[] = [];
const stub: Rollups = {
  async routineRef(ref, tz) {
    asked.push({ ref, tz });
    return ref === GOOD ? { n: 12 } : ref === THIN ? { n: 4 } : null;
  },
};
const night = () => as(P.N, NIGHT_SESSION);
const habit = (evidence: string[]) =>
  addOp(evidence, {
    source: 'observed',
    kind: 'routine',
    subject: 'guitar',
    text: 'Practises on Monday and Wednesday nights',
  });

beforeAll(async () => {
  P = await principals();
  ROLLUPS.source = () => stub;
});
afterAll(() => {
  ROLLUPS.source = sensesRollups;
});

describe('M5: a rollup ref the senses count again', () => {
  it('one counted at n ≥ 10 is evidence for an observed fact, labelled observed', async () => {
    expect(await labelled(night(), habit([GOOD]))).toBe('observed');
    expect(asked.at(-1)).toEqual({ ref: GOOD, tz: 'UTC' });
  });

  it('a thin or unknown one is bad_evidence, and so is an observed fact on words alone', async () => {
    expect(await labelled(night(), habit([THIN]))).toBe('bad_evidence');
    expect(await labelled(night(), habit([UNKNOWN]))).toBe('bad_evidence');
    const said = await ownerSays(P.D, 'I practise on Monday nights.');
    expect(await labelled(night(), habit([`msg:${said}`]))).toBe('too_little_evidence');
  });

  it('the route counts each distinct rollup a batch cites, at most 20, and nothing else', () => {
    const many = Array.from({ length: 25 }, (_, i) => `rollup:routines/x.y/mon/${i % 23}-${(i % 23) + 1}/2026-11-01`);
    const ops = [
      { op: 'add', evidence: [GOOD, GOOD, 'msg:abc'] },
      { op: 'supersede', new: { evidence: [THIN] } },
      { op: 'confirm', evidence: many },
    ];
    const refs = rollupRefs(ops);
    expect(refs.slice(0, 2)).toEqual([GOOD, THIN]);
    expect(refs).toHaveLength(20);
  });
});
