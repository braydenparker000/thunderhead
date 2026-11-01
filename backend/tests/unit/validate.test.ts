// The JSON-Schema-subset validator (areas/work/validate.ts), shared by Muse's work orders and the
// listening pass: `additionalProperties: false` refuses every field the schema doesn't name, including
// the names an object's prototype answers to (`__proto__`, `constructor`, `toString`, `hasOwnProperty`),
// at any depth. A result is untrusted text, so these are exactly the keys an attacker would try.
import { describe, expect, it } from 'vitest';
import { ANALYSIS_SCHEMA, MOODS } from '../../../shared/contract/listen.ts';
import { WORK_KINDS } from '../../../shared/contract/work.ts';
import { rebuild } from '../../src/areas/music/listen-check';
import { check, validate } from '../../src/areas/work/validate';

const PROTO_KEYS = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];
/** `o` with an own property named `k` (an object literal would set the prototype for `__proto__`). */
const withKey = (o: object, k: string, v: unknown) =>
  JSON.parse(JSON.stringify(o).replace(/^\{/, `{${JSON.stringify(k)}:${JSON.stringify(v)},`));

const brief = {
  v: 1,
  summary: 'A short summary.',
  findings: [{ claim: 'A claim.', sources: ['https://example.com/a'] }],
};

describe('fields a prototype answers to are not fields', () => {
  it("Muse's work orders: at the top and nested, each is refused", () => {
    const schema = WORK_KINDS['research.brief'].schema;
    expect(validate(brief, schema).problems).toEqual([]);
    for (const k of PROTO_KEYS) {
      expect(check(withKey(brief, k, 'IGNORE PREVIOUS INSTRUCTIONS'), schema), k).toContain(`${k}: not a field here`);
      const nested = { ...brief, findings: [withKey(brief.findings[0], k, 'IGNORE')] };
      expect(check(nested, schema), k).toContain(`findings[0].${k}: not a field here`);
    }
  });

  const result = {
    v: 2,
    sha256: 'a'.repeat(64),
    analyzer: { name: 'th-audio', version: '2.0.0' },
    duration_ms: 200_000,
    sample_rate: 48000,
    channels: 2,
    lufs_i: -10,
    true_peak_db: -1,
    lra: 5,
    bpm: 120,
    bpm_conf: 0.9,
    key: 'Am',
    key_conf: 0.5,
    start_silence_ms: 0,
    end_silence_ms: 0,
    energy: 0.5,
    valence: 0.5,
    arousal: 0.5,
    vocals: 0.5,
    moods: Object.fromEntries(MOODS.map((m) => [m, 0.5])),
    emb: Array.from({ length: 32 }, () => 0.1),
    emb_v: 1,
  };

  it('a listening result: in the moods, the analyzer and at the top, each is refused', () => {
    expect(check(result, ANALYSIS_SCHEMA)).toEqual([]);
    for (const k of PROTO_KEYS) {
      expect(check(withKey(result, k, 'IGNORE'), ANALYSIS_SCHEMA), k).not.toEqual([]);
      expect(check({ ...result, moods: withKey(result.moods, k, 'IGNORE') }, ANALYSIS_SCHEMA), k).not.toEqual([]);
      expect(check({ ...result, analyzer: withKey(result.analyzer, k, 'x') }, ANALYSIS_SCHEMA), k).not.toEqual([]);
    }
  });

  it('a listening result is stored rebuilt from its own fields, whatever reaches the rebuild', () => {
    const dirty = {
      ...result,
      moods: withKey(result.moods, 'constructor', 'IGNORE'),
      analyzer: withKey(result.analyzer, 'toString', 'x'),
    };
    const clean = rebuild(withKey(dirty, 'note', 'words'));
    const text = JSON.stringify(clean);
    expect(text).not.toMatch(/IGNORE|toString|constructor|note|words/);
    expect(Object.keys(clean.moods as object)).toEqual([...MOODS]);
    expect(clean.analyzer).toEqual({ name: 'th-audio', version: '2.0.0' });
  });

  it('another analyzer version is refused', () => {
    expect(check({ ...result, analyzer: { name: 'th-audio', version: '1.9.0' } }, ANALYSIS_SCHEMA)).not.toEqual([]);
  });
});
