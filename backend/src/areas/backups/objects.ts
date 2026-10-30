// The objects backed up beside Core (DATA.md §10, §11.1): Music's catalog (P5), the Senses' rollups
// and archive records (P5) and Study's library (P7). Each has its own job and manifest in the weekly
// backup, and its tables come by RPC, in its own key order, as `<class>.<table>` in the export.
import type { BackupClass } from '../../../../shared/contract/backups.ts';
import { LIBRARY_EXPORT, libraryObject } from '../../objects/library';
import { MUSIC_TABLES, musicObject } from '../../objects/music';
import { SENSES_EXPORT, sensesObject } from '../../objects/senses';
import type { BackupOf } from './ops';
import type { Row } from './rows';

export type OtherClass = Exclude<BackupClass, 'core'>;
export const OTHER_CLASSES: readonly OtherClass[] = ['music', 'senses', 'library'];

/** `<class>.<table>` names in "download everything". */
export const OTHER_EXPORT = (): string[] => [
  ...MUSIC_TABLES.map((t) => `music.${t}`),
  ...SENSES_EXPORT.map((t) => `senses.${t}`),
  ...LIBRARY_EXPORT.map((t) => `library.${t}`),
];

/** What each object's backup needs when it starts; an object that can't answer is left out. */
export async function backupsOf(env: Env): Promise<Partial<Record<OtherClass, BackupOf>>> {
  const ask = (p: Promise<BackupOf>) => p.catch(() => undefined);
  const [music, senses, library] = await Promise.all([
    ask(musicObject(env).backupOf()),
    ask(sensesObject(env).backupOf()),
    ask(libraryObject(env).backupOf()),
  ]);
  return { music, senses, library };
}

type Page = { rows: Row[]; last: unknown[] | null };

/** One page of another object's table, in its key order. */
export async function pageOf(env: Env, cls: OtherClass, table: string, after: unknown[] | null, limit: number) {
  const p =
    cls === 'music'
      ? musicObject(env).page(table, after, limit)
      : cls === 'senses'
        ? sensesObject(env).page(table, after, limit)
        : libraryObject(env).page(table, after, limit);
  return (await p) as unknown as Page;
}

/** `music.tracks` → the class and the table; null for Core's own. */
export function splitName(name: string): { cls: OtherClass; table: string } | null {
  const dot = name.indexOf('.');
  const cls = name.slice(0, dot) as OtherClass;
  return dot > 0 && OTHER_CLASSES.includes(cls) ? { cls, table: name.slice(dot + 1) } : null;
}
