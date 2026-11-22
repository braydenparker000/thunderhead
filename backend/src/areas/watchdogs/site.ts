// The outside watcher's word on the site (OPERATIONS.md §8.5): the live watch (GitHub, every 30
// minutes) finds the site not loading while the Worker answers, or loading again, and says so on
// POST /v1/ops/site. The Worker keeps when it went down (setting `ops.site`), so the owner gets one
// push when it goes down and one when it is back, however often the watch repeats itself.

import type { Writer } from '../../objects/commit';
import { getSetting, putSetting } from '../settings/store';

/** Records the watch's word; returns the push it calls for, or null when nothing changed. */
export function siteWord(w: Writer, state: 'down' | 'up'): 'down' | 'up' | null {
  const v = getSetting(w.db, 'ops.site') as { down_since?: unknown } | undefined;
  const down = typeof v?.down_since === 'number';
  if (state === 'down' && !down) {
    putSetting(w.db, 'ops.site', { down_since: w.at }, 'ci', w.at);
    return 'down';
  }
  if (state === 'up' && down) {
    putSetting(w.db, 'ops.site', { down_since: null }, 'ci', w.at);
    return 'up';
  }
  return null;
}
