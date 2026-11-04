// The mind changing one of the owner's settings (`settings.set`, verbs/worker.ts), and putting a
// row back (its undo, and the Briefing's pins'). The catalogue says which keys exist and which values
// each allows (shared/contract/settings.ts); the mind may change a Worker setting in it, never its
// own standing permissions (`mind.permit.*`), the switch that has it ask before outside sources
// (`mind.ask_outside`), how much it may speak unasked (`mind.speech`) or Privacy and data
// (`privacy.*`): those are the owner's alone. Its standing
// permission (`settings`) was checked by the verb's gate.
import { settingSpec, validSetting } from '../../../../shared/contract/settings';
import { canonicalJson } from '../../lib/canonical';
import { Fail, invalid } from '../../lib/result';
import type { Writer } from '../../objects/commit';
import { deleteSetting, getSetting, putSetting } from './store';

/** Keys only the owner changes, whatever the mind's standing permission says. */
export const ownerOnly = (key: string) =>
  key.startsWith('mind.permit.') || key === 'mind.ask_outside' || key === 'mind.speech' || key.startsWith('privacy.');

/** How to put a row back: its value before, or `unset` (the catalogue's default applies again),
 * only while it still holds `expect` (what the mind wrote). */
export interface SettingWas {
  key: string;
  value: unknown;
  unset: boolean;
  expect: unknown;
}

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

/** Writes `key` (its change-feed row too) and returns how to put it back; null when it already
 * holds `value` (nothing written). */
export function writeSetting(w: Writer, actor: string, key: string, value: unknown): SettingWas | null {
  const had = getSetting(w.db, key);
  if (had !== undefined && same(had, value)) return null;
  putSetting(w.db, key, value, actor, w.at);
  w.change('setting', `setting:${key}`);
  return { key, value: had ?? null, unset: had === undefined, expect: value };
}

/** `settings.set`: a catalogued Worker setting to a value the catalogue allows. */
export function mindSet(
  w: Writer,
  actor: string,
  key: string,
  value: unknown,
): { previous: unknown; was: SettingWas | null } {
  const spec = settingSpec(key);
  if (spec?.scope !== 'worker') throw invalid('args.key', 'a setting in the catalogue that the Worker keeps');
  if (ownerOnly(key)) throw new Fail('forbidden', { reason: `${key} is the owner's alone` });
  if (!validSetting(spec, value)) throw invalid('args.value', `not one of ${key}'s values`);
  const had = getSetting(w.db, key);
  return { previous: (had === undefined ? spec.default : had) as unknown, was: writeSetting(w, actor, key, value) };
}

/** The undo: the row as it was, only while it still holds what was written (409 otherwise). */
export function restoreSetting(w: Writer, actor: string, was: SettingWas): void {
  const now = getSetting(w.db, was.key);
  if (now === undefined || !same(now, was.expect)) throw new Fail('conflict', { reason: 'the setting changed since' });
  if (was.unset) deleteSetting(w.db, was.key);
  else putSetting(w.db, was.key, was.value, actor, w.at);
  w.change('setting', `setting:${was.key}`);
}
