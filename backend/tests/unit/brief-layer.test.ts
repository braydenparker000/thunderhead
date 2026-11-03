// The layered briefing (MEMORY.md §9, MIND-PLAN §2.5): the first 2,000 characters are sections 1
// and 2, whole, with today's state, the voice, the owner in their own words, their loose ends and
// the verb classes' positions, and nothing outside; then the day (section 7); then where the rest
// is, the skills among it (section 8). Every part keeps its budget. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { SKILLS } from '../../../shared/contract/skills.ts';
import { buildBrief, CORE_MAX, VOICE } from '../../src/areas/mind/brief';
import { LAYER_MAX, NOW_MAX } from '../../src/areas/mind/brief-layer';
import { fact, input, msg, section, thread } from '../brief-helpers';

const behavior = Object.values(
  import.meta.glob('../../../docs/mind/BEHAVIOR.md', { query: '?raw', import: 'default', eager: true }),
)[0] as string;

const SETTINGS = [
  'mind.permit.music: quiet (default)',
  'mind.permit.podcasts: quiet (default)',
  'mind.permit.reminders: tell (default)',
  'mind.permit.settings: tell (default)',
  'mind.permit.muse: ask (default)',
  'mind.permit.watch: tell (default)',
  'mind.permit.practice: tell',
  'mind.permit.tiles: quiet (default)',
  'mind.permit.titles: quiet (default)',
  'mind.permit.outside: ask (default)',
];
/** Words that came from outside text, or are not the owner's own about themselves. */
const NOT_OWN = [
  'Hates jazz',
  'Read the article the page named',
  'Gig at the hall',
  'Opens Guitar after lunch',
  'Their sister plays cello',
];

const rich = (over: Parameters<typeof input>[0] = {}) =>
  input({
    facts: [
      fact({ text: 'Prefers short answers on the phone', pinned: 1 }),
      fact({ kind: 'goal', text: 'Wants to play the second piece at 100 bpm' }),
      fact({ text: 'Hates jazz', provenance: 'outside', source: 'inferred', confidence: 0.6 }),
      fact({
        kind: 'habit',
        text: 'Opens Guitar after lunch',
        source: 'observed',
        provenance: 'observed',
        confidence: 0.8,
      }),
      fact({ about: 'person', kind: 'fact', text: 'Their sister plays cello' }),
    ],
    threads: [thread(1, 'Read the article the page named', 'outside'), thread(2, 'Fix the metronome')],
    weather: '11°, Rain from 16:00 to 18:00. Tomorrow 6° to 12°.',
    calendar: ['calendar today: 18:00–19:00 "Choir"'],
    calendarShared: ['calendar today: 20:00–21:00 "Gig at the hall" (outside)'],
    due: ['due 15:00: "Call the plumber"', 'scheduled: 1 waiting, the next at 18:00 (th verbs scheduled)'],
    playing: 'music: a song started at 11:50 (10 min ago), not skipped or finished since (th music now)',
    settings: SETTINGS,
    waiting: [msg(1, 'Is the metronome fixed?')],
    arranged: ['06:12 home/line.2 ← line · kept: the bus leaves early on Tuesdays'],
    predicted: ['app.open app=guitar · 70%: practised four days running'],
    tiles: ['Due: 1 today · Next at 15:00'],
    ...over,
  });
const layer = (core: string) => core.slice(0, core.indexOf('\n\n## 3. '));

describe('the first 2,000 characters (sections 1–2)', () => {
  it('hold sections 1 and 2 whole, with today, the voice, the owner, their loose ends and the positions', () => {
    const b = buildBrief(rich());
    expect(b.core.indexOf('\n\n## 3. ')).toBeLessThanOrEqual(LAYER_MAX);
    const first = b.core.slice(0, LAYER_MAX);
    for (const want of [
      '## 1. Now\nTuesday 12:00 (UTC) · day 2026-11-03 · role chat',
      'wake: message · wakes today 1 · pre-warms left 8',
      'laws: pinned · open decisions 0 · quiet: off',
      ...VOICE,
      'weather: 11°, Rain from 16:00 to 18:00.',
      'calendar today: 18:00–19:00 "Choir"',
      'due 15:00: "Call the plumber"',
      'scheduled: 1 waiting, the next at 18:00',
      'music: a song started at 11:50',
      '## 2. The owner\nIn their own words:\n[f:',
      'Prefers short answers on the phone',
      'Wants to play the second piece at 100 bpm',
      'Loose ends:\n[',
      'Fix the metronome',
      "Verbs by class, the owner's positions now: music quiet · podcasts quiet · reminders tell · settings tell · muse ask · watch tell · practice tell · tiles quiet · titles quiet; money, deleting your data, keys and access, reaching another person: always ask.",
    ])
      expect(first).toContain(want);
    // The owner's words come in the profile's order: pinned first.
    expect(first.indexOf('Prefers short answers')).toBeLessThan(first.indexOf('Wants to play'));
  });

  it('hold nothing outside, for a clean session and for one that read outside text', () => {
    for (const tainted of [false, true]) {
      const b = buildBrief(rich({ tainted }));
      const first = layer(b.core);
      for (const t of NOT_OWN) expect(first, t).not.toContain(t);
      expect(first).not.toContain('(outside');
      // What was left out is after them: a shared calendar in the day, the loose end in 8.
      expect(section(b.core, 7)).toContain(
        'Shared calendars:\ncalendar today: 20:00–21:00 "Gig at the hall" (outside)',
      );
      expect(section(b.core, 8)).toContain('Loose ends written after outside text:');
      if (tainted) expect(section(b.core, 8)).toContain('(outside) Read the article the page named');
      else expect(section(b.core, 8)).toMatch(/\(outside, kept back\) a loose end \(mind, since /);
    }
  });

  it('carry the voice on every wake, every role, as BEHAVIOR.md §10 says it', () => {
    const ten = behavior.slice(behavior.indexOf('## 10. Tone'), behavior.indexOf('## 11.'));
    for (const l of VOICE) {
      expect(ten).toContain(l);
      expect(l).not.toMatch(/!|outside/);
    }
    for (const role of ['chat', 'night', 'reflex'] as const)
      expect(section(buildBrief(input({ role })).core, 1)).toContain(VOICE.join('\n'));
  });

  it('keep their budgets when crowded: section 1 ≤ 1,300, the layer ≤ 2,000, the core ≤ 9,500', () => {
    const b = buildBrief(
      rich({
        facts: Array.from({ length: 40 }, (_, i) => fact({ text: `Owner fact ${i} ${'f'.repeat(80)}` })),
        threads: Array.from({ length: 30 }, (_, i) => thread(i, `Loose end ${i} ${'z'.repeat(100)}`)),
        calendar: Array.from(
          { length: 20 },
          (_, i) => `calendar today: ${10 + (i % 10)}:00 "Event ${i} ${'c'.repeat(40)}"`,
        ),
        due: Array.from({ length: 3 }, (_, i) => `due 1${i}:00: "${'d'.repeat(80)}"`),
        watchdogs: [{ name: 'errors.spike', since: Date.UTC(2026, 10, 3, 11), handled: null }],
        quota: "Today's database use is at 64% of the free plan's daily limit.",
        tainted: true,
        waiting: Array.from({ length: 30 }, (_, i) => msg(i, 'w'.repeat(300))),
      }),
    );
    expect(section(b.core, 1).length - '## 1. Now\n'.length).toBeLessThanOrEqual(NOW_MAX);
    expect(layer(b.core).length).toBeLessThanOrEqual(LAYER_MAX);
    expect(b.core.length).toBeLessThanOrEqual(CORE_MAX);
    const two = section(b.core, 2);
    expect(two).toMatch(/\(\+\d+ more: th brief --section 9\)/);
    expect(two).toMatch(/\(\+\d+ more: th brief --section 10\)/);
    expect(two).toContain('Verbs by class');
    expect(section(b.core, 1)).toMatch(/\(\+\d+ more: th get \/v1\/briefing\/calendar days=2\)/);
  });

  it('say the wake budget when there is one', () => {
    expect(buildBrief(input({ wakesToday: 3, wakeBudget: 12 })).core).toContain('wakes today 3 of 12 ·');
    expect(buildBrief(input({ wakesToday: 3 })).core).toContain('wakes today 3 ·');
  });
});

describe('then the day, then on demand', () => {
  it('section 7: the arrangements and how they were met, the predictions, the Briefing, each in its budget', () => {
    const b = buildBrief(rich());
    const seven = section(b.core, 7);
    expect(seven).toContain('Arranged on 2026-11-03, each as the owner met it so far');
    expect(seven).toContain('06:12 home/line.2 ← line · kept: the bus leaves early on Tuesdays');
    expect(seven).toContain('Predicted for 2026-11-03:\napp.open app=guitar · 70%: practised four days running');
    expect(seven).toContain('The Briefing shows:\nDue: 1 today · Next at 15:00');
    const crowded = buildBrief(
      rich({
        arranged: Array.from(
          { length: 20 },
          (_, i) => `06:${10 + i} home/line.1 ← line · no answer yet: ${'a'.repeat(60)}`,
        ),
      }),
    );
    expect(section(crowded.core, 7)).toMatch(/\(\+\d+ more: th ledger --kind arrangement\)/);
    expect(section(buildBrief(input()).core, 7)).toContain('Nothing arranged or predicted for 2026-11-03');
  });

  it('section 8 names every skill as th skill <name>, and the full file, recall and the settings', () => {
    const eight = section(buildBrief(input()).core, 8);
    expect(eight).toContain('th skill <name>');
    for (const s of SKILLS) expect(eight).toContain(s);
    expect(eight).toContain('th recall "<q>"');
    expect(eight).toContain('Your settings: th brief --section 13');
  });

  it('reflex: no today, no owner, no skills', () => {
    const b = buildBrief(rich({ role: 'reflex', facts: [], threads: [] }));
    expect(section(b.core, 2)).toBe('## 2. The owner\nNot in the reflex briefing (reflex reads no memory).');
    for (const t of ['weather:', 'calendar today', 'due 15:00', 'music:', 'th skill']) expect(b.core).not.toContain(t);
  });
});
