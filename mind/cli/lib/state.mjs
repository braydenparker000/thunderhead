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

export function writeThFile(name, text) {
  mkdirSync(thDir(), {recursive: true});
  const path = join(thDir(), name);
  writeFileSync(path, text);
  return path;
}
