// The verbs' pure parts: the briefing's verb table (section 13, mind/brief-verbs.ts) and where a
// pinned Briefing tile goes (briefing/pins.ts). Everything is synthetic.
import { describe, expect, it } from 'vitest';
import type { BriefingTile } from '../../../shared/contract/briefing.ts';
import { VERBS } from '../../../shared/contract/verbs.ts';
import { arrange, withPin } from '../../src/areas/briefing/pins';
import { VERBS_MAX, verbTable } from '../../src/areas/mind/brief-verbs';

const SETTINGS = [
  'mind.voice: plain (default)',
  'mind.permit.music: ask',
  'mind.permit.podcasts: quiet (default)',
  'mind.permit.reminders: tell (default)',
  'mind.permit.settings: tell (default)',
  'mind.permit.tiles: quiet (default)',
];

describe("the briefing's verb table", () => {
  const table = verbTable(SETTINGS);
  const row = (name: string) => table.split('\n').find((l) => l.startsWith(`${name} · `));

  it('lists every verb the mind may queue, with where it runs, its class and the position now', () => {
    for (const [name, v] of Object.entries(VERBS)) expect(Boolean(row(name)), name).toBe(v.queueable);
    expect(row('music.queue')).toBe(
      'music.queue · app (music) · music: ask · add songs to the queue, next or at the end',
    );
    expect(row('settings.set')).toMatch(/^settings\.set · worker · settings: tell · /);
    // Never below tell, and the owner's own words have no class.
    expect(row('podcasts.unfollow')).toMatch(/· podcasts: tell \(never quiet\) ·/);
    expect(row('memory.note')).toMatch(/· no class \(the owner's own words only\) ·/);
    expect(table.length).toBeLessThanOrEqual(VERBS_MAX);
    // One line on later and plans, naming the verbs that never wait.
    expect(table.split('\n')[1]).toMatch(
      /^Later: th verb … --at <time> .*never music\.never, reminder\.move, memory\.note, study\.pace_goal\).* th plan <file\.json>/,
    );
    // Section 13's settings check reads `<key>: ` at a line's start: no verb line looks like one.
    expect(table).not.toMatch(/^[a-z]+\.[a-z_.]+: /m);
  });
});

describe('pinned Briefing tiles', () => {
  const t = (kind: string, slot = ''): BriefingTile => ({ kind, slot }) as unknown as BriefingTile;
  const names = (ts: BriefingTile[]) => ts.map((x) => (x.kind === 'night' ? x.slot : x.kind));

  it('go right after "Waiting on you", newest pin first; the rest keep their order', () => {
    const tiles = [t('waiting'), t('due'), t('night', 'practice'), t('night', 'study'), t('holiday')];
    expect(names(arrange(tiles, []))).toEqual(['waiting', 'due', 'practice', 'study', 'holiday']);
    expect(names(arrange(tiles, ['holidays', 'study']))).toEqual(['waiting', 'holiday', 'study', 'due', 'practice']);
    // A pin with nothing to show changes nothing.
    expect(names(arrange(tiles.slice(1, 3), ['note.1']))).toEqual(['due', 'practice']);
  });

  it('at most three; pinning again moves it first; unpinning takes it out', () => {
    expect(withPin(['due', 'study', 'built'], 'holidays', true)).toEqual(['holidays', 'due', 'study']);
    expect(withPin(['due', 'study'], 'study', true)).toEqual(['study', 'due']);
    expect(withPin(['due', 'study'], 'due', false)).toEqual(['study']);
  });
});
