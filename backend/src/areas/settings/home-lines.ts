// Lines on home (`mind.home_lines`, MENU-AND-SETTINGS.md §6.6, HOME.md §2.2): how many of the mind's
// line slots on home it may fill, 0 to 4; the catalogue's default while unset. One read by the key.
import { settingSpec, validSetting } from '../../../../shared/contract/settings.ts';
import type { Db } from '../../objects/base';
import { getSetting } from './store';

export const HOME_LINES_KEY = 'mind.home_lines';

export function homeLines(db: Db): number {
  const spec = settingSpec(HOME_LINES_KEY);
  const v = getSetting(db, HOME_LINES_KEY);
  return spec && validSetting(spec, v) ? (v as number) : Number(spec?.default ?? 4);
}
