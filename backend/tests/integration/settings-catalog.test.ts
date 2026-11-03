// The settings catalogue in the Worker (shared/contract/settings.ts, MENU-AND-SETTINGS.md §6):
// PATCH /v1/settings takes every worker key, each checked by its kind, refuses anything else as
// before (422), and the mind's briefing lists the `mind: true` keys in section 13, "Your settings".
import { beforeAll, describe, expect, it } from 'vitest';
import type { Settings } from '../../../shared/contract/api';
import { SETTINGS, type SettingSpec, type SettingValue, validSetting } from '../../../shared/contract/settings';
import { CATALOG_PATCH } from '../../src/areas/settings/catalog';
import { api, apiJson } from '../helpers';
import { brief, CHAT_SESSION, principals } from '../memory-helpers';

const specs = SETTINGS as readonly SettingSpec[];
const worker = specs.filter((s) => s.scope === 'worker');
type Refused = { error: { code: string; details?: { path: string }[] } };
const issue = (r: { body: Refused }) => [r.body.error.code, r.body.error.details?.[0]?.path];

/** A value the catalogue allows that isn't the default. */
function other(s: SettingSpec): SettingValue {
  const values = (s.options ?? []).map((o) => o.value);
  if (s.kind === 'switch') return !s.default;
  if (s.kind === 'order') return [...(s.default as readonly string[])].reverse().slice(1);
  if (s.kind === 'text') return 'x';
  if (s.kind === 'links') return [{ url: 'https://calendar.example.com/a/basic.ics', mine: false }];
  return values.find((v) => v !== s.default) as SettingValue;
}

let D = '';
let C = '';
const yourSettings = async () => {
  const full = (await brief(C, CHAT_SESSION, 'chat')).body.full;
  return full.slice(full.indexOf('## 13. Your settings'));
};

beforeAll(async () => {
  ({ D, C } = await principals());
});

describe('the settings catalogue', () => {
  it('is one list of distinct keys, each with a valid default, a detail line and the options its kind needs', () => {
    expect(new Set(specs.map((s) => s.key)).size).toBe(specs.length);
    for (const s of specs) {
      expect(validSetting(s, s.default), s.key).toBe(true);
      expect(s.detail.length, s.key).toBeGreaterThan(10);
      if (['choice', 'range', 'order'].includes(s.kind)) expect(s.options?.length, s.key).toBeGreaterThan(1);
      if (s.mind) expect(s.scope, `${s.key}: the mind reads only what the Worker keeps`).toBe('worker');
      // The Worker's own keys stay its own: the owner can't set the mind's status or its laws pin.
      expect(['mind.status', 'mind.stop', 'mind.backoff', 'owner.tz', 'quiet.start', 'quiet.end']).not.toContain(s.key);
    }
    // PATCH's schema has exactly the worker keys.
    expect(Object.keys(CATALOG_PATCH).sort()).toEqual(worker.map((s) => s.key).sort());
  });

  it('PATCH takes every worker key at its default and at another value, and GET gives it back', async () => {
    for (const value of [(s: SettingSpec) => s.default, other]) {
      const body = Object.fromEntries(worker.map((s) => [s.key, value(s)]));
      const r = await apiJson<Settings>('PATCH', '/v1/settings', { token: D, body });
      expect(r.status).toBe(200);
      const got = (await apiJson<Settings>('GET', '/v1/settings', { token: D })).body;
      for (const s of worker) expect(got[s.key], s.key).toEqual(value(s));
    }
  });

  it('refuses a key it does not know, a phone key, and the mind changing anything', async () => {
    for (const key of ['mind.unknown', 'appearance.glass', 'chat.fold', 'mind.status'])
      expect((await api('PATCH', '/v1/settings', { token: D, body: { [key]: 'x' } })).status, key).toBe(422);
    expect((await api('PATCH', '/v1/settings', { token: C, body: { 'mind.voice': 'drier' } })).status).toBe(403);
  });

  it('checks each value by its kind', async () => {
    const bad: [string, unknown][] = [
      ['mind.ask_outside', 'yes'],
      ['mind.ask_outside', 1],
      ['mind.voice', 'loud'],
      ['mind.voice', 2],
      ['mind.night_budget', 20],
      ['mind.night_budget', '30'],
      ['mind.permit.music', 'always'],
      ['briefing.tiles', ['weather', 'weather']],
      ['briefing.tiles', ['weather', 'horoscope']],
      ['briefing.tiles', 'weather'],
      ['briefing.tiles', [...Array(9).keys()].map(String)],
      ['briefing.holidays', 'ZZ'],
      ['privacy.errors', null],
    ];
    for (const [key, value] of bad) {
      const r = await apiJson<Refused>('PATCH', '/v1/settings', { token: D, body: { [key]: value } });
      expect([r.status, ...issue(r)], `${key} = ${JSON.stringify(value)}`).toEqual([422, 'validation', key]);
    }
    // An order may hide tiles: any subset, each once, in any order.
    const ok = await apiJson<Settings>('PATCH', '/v1/settings', {
      token: D,
      body: { 'briefing.tiles': ['report', 'weather'], 'briefing.holidays': 'GB' },
    });
    expect([ok.status, ok.body['briefing.tiles']]).toEqual([200, ['report', 'weather']]);
  });

  it('takes up to 3 calendar links, each a public https address, and says why it refuses one', async () => {
    const put = (v: unknown) =>
      apiJson<Refused & { error: { details?: { path: string; issue: string }[] } }>('PATCH', '/v1/settings', {
        token: D,
        body: { 'briefing.calendars': v },
      });
    const link = (url: string, mine = true) => [{ url, mine }];
    const why: [unknown, string, string][] = [
      [link('http://calendar.example.com/a.ics'), 'briefing.calendars.0.url', 'Only https links'],
      [link('https://192.0.2.10/a.ics'), 'briefing.calendars.0.url', 'Only a public address'],
      [link('https://localhost/a.ics'), 'briefing.calendars.0.url', 'Only a public address'],
      [link('https://calendar.local/a.ics'), 'briefing.calendars.0.url', 'Only a public address'],
      [link('https://user:pw@calendar.example.com/a.ics'), 'briefing.calendars.0.url', 'user, password or port'],
      [link(`https://calendar.example.com/${'a'.repeat(500)}.ics`), 'briefing.calendars.0.url', 'over 512 characters'],
      [link('not a link'), 'briefing.calendars.0.url', 'That is not a link.'],
    ];
    for (const [value, path, words] of why) {
      const r = await put(value);
      expect([r.status, r.body.error.details?.[0]?.path], JSON.stringify(value)).toEqual([422, path]);
      expect(r.body.error.details?.[0]?.issue).toContain(words);
    }
    const a = 'https://calendar.example.com/a.ics';
    for (const bad of [
      [...link(a), ...link(a, false)],
      ['a', 'b', 'c', 'd'].map((x) => ({ url: `https://calendar.example.com/${x}.ics`, mine: true })),
      [{ url: a }],
      [{ url: a, mine: true, extra: 1 }],
      a,
    ])
      expect((await put(bad)).status, JSON.stringify(bad)).toBe(422);
    const three = ['a', 'b', 'c'].map((x, i) => ({ url: `https://calendar.example.com/${x}.ics`, mine: i !== 1 }));
    expect((await put(three)).status).toBe(200);
    // The owner's devices see the links; the mind sees only each link's host and its mark.
    expect((await apiJson<Settings>('GET', '/v1/settings', { token: D })).body['briefing.calendars']).toEqual(three);
    expect((await apiJson<Settings>('GET', '/v1/settings', { token: C })).body['briefing.calendars']).toEqual([
      { host: 'calendar.example.com', mine: true },
      { host: 'calendar.example.com', mine: false },
      { host: 'calendar.example.com', mine: true },
    ]);
    expect((await put([])).status).toBe(200);
  });

  it("the mind's briefing lists every mind setting as key: value, marked (default) until changed", async () => {
    const reset = Object.fromEntries(worker.map((s) => [s.key, s.default]));
    await api('PATCH', '/v1/settings', { token: D, body: reset });
    // Stored at the default reads as a choice the owner made: only a missing key is "(default)".
    let section = await yourSettings();
    const mind = specs.filter((s) => s.mind);
    expect(mind.length).toBeGreaterThan(15);
    for (const s of mind) expect(section, s.key).toMatch(new RegExp(`^${s.key.replaceAll('.', '\\.')}: `, 'm'));
    for (const s of specs.filter((x) => !x.mind)) expect(section, s.key).not.toContain(`${s.key}:`);
    expect(section).toContain('mind.voice: plain\n');
    expect(section).toContain('mind.night_budget: 30 min\n');
    expect(section).toContain('mind.ask_outside: on\n');
    expect(section).toContain('mind.permit.muse: ask\n');
    expect(section).toContain('briefing.tiles: weather, due, holidays, study, built, podcasts, notes, report');
    expect(section).toContain('ask = a decision card first');

    await api('PATCH', '/v1/settings', {
      token: D,
      body: { 'mind.voice': 'drier', 'mind.permit.music': 'ask', 'mind.ask_outside': false, 'briefing.tiles': [] },
    });
    section = await yourSettings();
    expect(section).toContain('mind.voice: drier\n');
    expect(section).toContain('mind.permit.music: ask\n');
    expect(section).toContain('mind.ask_outside: off\n');
    expect(section).toMatch(/^briefing\.tiles: none$/m);
    // The core points at it.
    expect((await brief(C, CHAT_SESSION, 'chat')).body.core).toContain('Your settings: th brief --section 13');
  });
});

describe('a fresh owner', () => {
  it('sees every mind setting at its default', async () => {
    const { mindSettingLines } = await import('../../src/areas/settings/catalog');
    const lines = mindSettingLines({ one: () => null, all: () => [] } as never);
    expect(lines).toContain('mind.voice: plain (default)');
    expect(lines).toContain('mind.idle: 120 min (default)');
    expect(lines.every((l) => l.endsWith('(default)'))).toBe(true);
  });
});
