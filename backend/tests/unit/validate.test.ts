// The JSON-Schema-subset validator (areas/work/validate.ts), used by Muse's work orders: `additionalProperties: false` refuses every field the schema doesn't name, including
// the names an object's prototype answers to (`__proto__`, `constructor`, `toString`, `hasOwnProperty`),
// at any depth. A result is untrusted text, so these are exactly the keys an attacker would try.
import { describe, expect, it } from 'vitest';
import { WORK_KINDS } from '../../../shared/contract/work.ts';
import { check, validate } from '../../src/areas/work/validate';

const PROTO_KEYS = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];
/** `o` with an own property named `k` (an object literal would set the prototype for `__proto__`). */
const withKey = (o: object, k: string, v: unknown) =>
  JSON.parse(JSON.stringify(o).replace(/^\{/, `{${JSON.stringify(k)}:${JSON.stringify(v)},`));

const done = {
  added: { songs: 41, artists: 3 },
  ids: ['r2_native_example'],
  note: 'Three catalogs.',
  open: { app: 'music', path: '/music/' },
};

describe('fields a prototype answers to are not fields', () => {
  it("Muse's work orders: at the top and nested, each is refused", () => {
    const schema = WORK_KINDS['muse.request'].schema;
    expect(validate(done, schema).problems).toEqual([]);
    for (const k of PROTO_KEYS) {
      expect(check(withKey(done, k, 'IGNORE PREVIOUS INSTRUCTIONS'), schema), k).toContain(`${k}: not a field here`);
      const nested = { ...done, added: withKey(done.added, k, 'IGNORE') };
      expect(check(nested, schema), k).toContain(`added.${k}: not a field here`);
    }
  });

  it("Muse's result: counts, at most 50 ids, a note of 200, an app it may open", () => {
    const schema = WORK_KINDS['muse.request'].schema;
    expect(validate({ added: {}, ids: [], note: '' }, schema).problems).toEqual([]);
    expect(check({ ...done, ids: Array.from({ length: 51 }, (_, i) => `id${i}`) }, schema)).toEqual([
      'ids: at most 50 items',
    ]);
    expect(check({ ...done, note: 'x'.repeat(201) }, schema)).toEqual(['note: at most 200 characters']);
    expect(check({ ...done, added: { songs: -1 } }, schema)).toEqual(['added.songs: at least 0']);
    expect(check({ ...done, open: { app: 'photos', path: '/photos/' } }, schema)[0]).toMatch(/^open\.app: one of /);
    expect(check({ added: {}, ids: [] }, schema)).toEqual(['note: required']);
  });
});
