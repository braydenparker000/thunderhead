// The settings catalogue in the Worker (shared/contract/settings.ts, MENU-AND-SETTINGS.md §6):
// PATCH /v1/settings takes every worker key in it, each checked by its kind (ops/schema.ts spreads
// CATALOG_PATCH into its strict object, so an unknown key is still 422), and the mind's briefing
// lists the `mind: true` ones (section 13, "Your settings"). A key is stored only once the owner
// changes it; until then every reader takes the catalogue's default. A text setting (the mind's
// name) is held to the mind's phrase lint too, since the mind's own words carry it.
import * as z from 'zod/mini';
import { lintMindText } from '../../../../shared/contract/lint.ts';
import {
  linkProblem,
  SETTINGS,
  type SettingSpec,
  type SettingValue,
  validSetting,
  type WorkerSettingKey,
} from '../../../../shared/contract/settings';
import type { Db } from '../../objects/base';
import { ownerOnly } from './mind-set';

const specs = SETTINGS as readonly SettingSpec[];
const values = (s: SettingSpec) => (s.options ?? []).map((o) => o.value);

/** The request schema for one setting: its kind's JSON type, then the catalogue's own check. */
function schemaFor(s: SettingSpec): z.ZodMiniType<SettingValue, SettingValue> {
  const check = z.refine<SettingValue>((v) => validSetting(s, v), `not one of ${s.key}'s values`);
  switch (s.kind) {
    case 'switch':
      return z.boolean();
    case 'choice':
      return z.string().check(check);
    case 'range':
      return z.number().check(check);
    case 'order':
      return z.array(z.string()).check(z.maxLength(values(s).length), check);
    case 'text':
      return z.string().check(
        z.maxLength(s.max ?? 200),
        check,
        z.refine((v) => lintMindText(v) === null, { error: (i) => lintMindText(String(i.input)) ?? '' }),
      );
    case 'links':
      // Each address checked on its own, so a refusal says which one and why (linkProblem's words).
      return z
        .array(
          z.strictObject({
            url: z.string().check(
              z.refine((u) => linkProblem(u, s.max) === null, {
                error: (i) => linkProblem(String(i.input), s.max) ?? '',
              }),
            ),
            mine: z.boolean(),
          }),
        )
        .check(z.maxLength(s.items ?? 3), check) as z.ZodMiniType<SettingValue, SettingValue>;
  }
}

/** What an agent may see of a setting: a calendar link is a key to its calendar, so only its host
 * and its mark leave for anyone but the owner's devices (PRIVACY.md §5). */
export function forAgents(settings: Record<string, unknown>): Record<string, unknown> {
  const v = settings['briefing.calendars'];
  if (!Array.isArray(v)) return settings;
  const host = (u: unknown) => {
    try {
      return new URL(String(u)).hostname;
    } catch {
      return '';
    }
  };
  return {
    ...settings,
    'briefing.calendars': v.map((l: { url?: unknown; mine?: unknown }) => ({
      host: host(l?.url),
      mine: l?.mine === true,
    })),
  };
}

/** Every worker key of the catalogue, optional, for PATCH /v1/settings's strict object. */
export const CATALOG_PATCH = Object.fromEntries(
  specs.filter((s) => s.scope === 'worker').map((s) => [s.key, z.optional(schemaFor(s))]),
) as Record<WorkerSettingKey, z.ZodMiniOptional<z.ZodMiniType<SettingValue, SettingValue>>>;

const MIND = specs.filter((s) => s.mind && s.scope === 'worker');

/** The stored values of `keys`, one lookup each by the primary key: a row read for each stored one. */
export function readSettings(db: Db, keys: readonly string[]): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (!keys.length) return out;
  for (const key of keys) {
    const r = db.one<{ value_json: string }>('SELECT value_json FROM settings WHERE key = ?', key);
    if (r) out.set(key, JSON.parse(r.value_json));
  }
  return out;
}

const shown = (s: SettingSpec, v: SettingValue): string => {
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (v === '') return 'none';
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'none';
  return s.unit ? `${v} ${s.unit}` : String(v);
};

/** The briefing's "Your settings" lines: `key: value` for every `mind: true` setting, in catalogue
 * order, marked `(default)` while the owner hasn't changed it (a stored value that is no longer
 * allowed counts as unchanged); one the mind may change (`settings.set`, not mind-set.ts ownerOnly)
 * then says what it does, in its detail line. */
export function mindSettingLines(db: Db): string[] {
  return mindSettings(db).lines;
}

/** The same lines, with each `mind: true` setting's value as it applies (the default unless a
 * stored one is allowed), from the one read: the briefing's name and hours come from it too. */
export function mindSettings(db: Db): { lines: string[]; value: (key: string) => SettingValue | undefined } {
  const stored = readSettings(
    db,
    MIND.map((s) => s.key),
  );
  const values = new Map(
    MIND.map((s) => [s.key, validSetting(s, stored.get(s.key)) ? (stored.get(s.key) as SettingValue) : s.default]),
  );
  const lines = MIND.map((s) => {
    const v = stored.get(s.key);
    const head = validSetting(s, v) ? `${s.key}: ${shown(s, v)}` : `${s.key}: ${shown(s, s.default)} (default)`;
    return ownerOnly(s.key) ? head : `${head} — ${s.detail}`;
  });
  return { lines, value: (key) => values.get(key) };
}
