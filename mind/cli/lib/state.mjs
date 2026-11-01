// Session-local state under $TMPDIR/th/. One small file per key, written atomically,
// so the background `th wait` and foreground commands never overwrite each other's keys.
import {mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export const thDir = () => join(tmpdir(), 'th');
export const briefPath = () => join(thDir(), 'brief.md');

const keyPath = key => join(thDir(), 'state', `${key.replace(/[^a-z0-9_-]/gi, '_')}.json`);

export function getState(key, fallback = null) {
  try { return JSON.parse(readFileSync(keyPath(key), 'utf8')); } catch { return fallback; }
}

export function setState(key, value) {
  try {
    mkdirSync(join(thDir(), 'state'), {recursive: true});
    const tmp = `${keyPath(key)}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(value));
    renameSync(tmp, keyPath(key));
  } catch { /* state is a convenience; th works without it */ }
}

/** The taint reading songs' tags leaves (the contract's `music.taint_source`): it holds for this
 * session only (the Worker never hands it to a later claim), so a full taint after it is still sent. */
export const SONG_TAINT = 'th music';

/** Records a taint the Worker has: the session's taint is `songs` while songs' tags are all it read,
 * `full` once anything else tainted it. */
export function markTainted(source) {
  const songsOnly = source === SONG_TAINT && (!getState('tainted') || getState('taint_scope') === 'songs');
  setState('tainted', true);
  setState('taint_scope', songsOnly ? 'songs' : 'full');
}

/** Whether a taint adds to the session's: none yet, or only songs so far and this one is more. */
export const taintAdds = taint =>
  !getState('tainted') || (getState('taint_scope') === 'songs' && taint?.source !== SONG_TAINT);

/** Marks a taint to send before th's next write (the hooks, RUNTIME.md §6.5): a full taint replaces
 * a songs one still waiting. */
export function markPending(taint) {
  const waiting = getState('taint_pending');
  if (!waiting || (waiting.source === SONG_TAINT && taint.source !== SONG_TAINT)) setState('taint_pending', {...taint, at: Date.now()});
}

export function writeThFile(name, text) {
  mkdirSync(thDir(), {recursive: true});
  const path = join(thDir(), name);
  writeFileSync(path, text);
  return path;
}
