// Photos (PHOTOS.md, DATA.md §4.14): one row per photo on the shelf, and the Drive ids of photos
// purged from Recently deleted until their originals are in Drive's own trash. Schema step 41; the
// recipe's two columns, step 42; its versions, step 43; the looks, step 44 (the next free
// number when it merged).
import { LOOK_LIMITS, PHOTO_LIMITS } from '../../../../shared/contract/photos.ts';
import { DAY } from '../../lib/time';
import type { Migration, TableInfo } from '../../objects/base';

export const PHOTOS_MIGRATIONS: Migration[] = [
  {
    version: 41,
    name: 'photos',
    kind: 'expand',
    sql: [
      // `preview_key` is the bucket key of the preview (`photos/previews/<id>.jpg`), never sent; a
      // photo the reconciliation found has none until a phone opens it.
      `CREATE TABLE photos (
        id TEXT PRIMARY KEY,
        drive_id TEXT,
        name TEXT NOT NULL,
        format TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        sha256 TEXT,
        camera TEXT,
        film TEXT,
        width INTEGER,
        height INTEGER,
        taken_at INTEGER NOT NULL,
        day TEXT NOT NULL,
        rating INTEGER NOT NULL DEFAULT 0,
        flag TEXT,
        preview_key TEXT,
        preview_sha TEXT,
        deleted_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) WITHOUT ROWID`,
      'CREATE UNIQUE INDEX photos_drive ON photos (drive_id)',
      'CREATE INDEX photos_shelf ON photos (day, taken_at) WHERE deleted_at IS NULL',
      'CREATE INDEX photos_deleted ON photos (deleted_at) WHERE deleted_at IS NOT NULL',
      // A purged photo's original, to go to Drive's trash on the next Drive pass (and never to come
      // back on the shelf through the reconciliation meanwhile).
      `CREATE TABLE photos_gone (
        drive_id TEXT PRIMARY KEY,
        purged_at INTEGER NOT NULL
      ) WITHOUT ROWID`,
    ],
  },
  {
    version: 42,
    name: 'photos_recipe',
    kind: 'expand',
    // A photo's recipe (PHOTOS.md, the editor): its canonical JSON (defaults left out) and that
    // JSON's SHA-256, so the same recipe again writes nothing. Null is "as shot".
    sql: ['ALTER TABLE photos ADD COLUMN recipe_json TEXT', 'ALTER TABLE photos ADD COLUMN recipe_sha TEXT'],
  },
  {
    version: 43,
    name: 'photo_versions',
    kind: 'expand',
    // A photo's versions (PHOTOS.md, Versions): a canonical recipe each, automatic or named, at most
    // 20 of each per photo (versions.ts holds the caps); gone with the photo when it is purged.
    sql: [
      `CREATE TABLE photo_versions (
        id TEXT PRIMARY KEY,
        photo_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT,
        recipe_json TEXT NOT NULL,
        recipe_sha TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) WITHOUT ROWID`,
      'CREATE INDEX photo_versions_photo ON photo_versions (photo_id, kind, created_at)',
    ],
  },
  {
    version: 44,
    name: 'photo_looks',
    kind: 'expand',
    // A look: a canonical recipe (≤ 4 KB, only its panels' keys) and the panels it sets, where it came
    // from, a preset's group as a tag, a recipe's film simulation and a credit line; at most 500
    // (looks.ts holds the cap). thumb_key is kept for a thumbnail in the private bucket: null for now.
    sql: [
      `CREATE TABLE photo_looks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        source TEXT NOT NULL,
        recipe_json TEXT NOT NULL,
        panels TEXT NOT NULL,
        tag TEXT,
        film TEXT,
        credit TEXT,
        thumb_key TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) WITHOUT ROWID`,
    ],
  },
];

export const PHOTOS_TABLES: Record<string, TableInfo> = {
  photos: {
    retention: `forever while on the shelf (ids, numbers, the camera's words); purged ${PHOTO_LIMITS.deleted_days} days after a delete`,
    backup: true,
    export: true,
  },
  photo_versions: {
    retention: 'forever while its photo is kept (at most 20 automatic and 20 named); purged with it',
    backup: true,
    export: true,
  },
  photo_looks: {
    retention: `forever until the owner deletes it (at most ${LOOK_LIMITS.max})`,
    backup: true,
    export: true,
  },
  photos_gone: {
    retention: 'until the original is in Drive’s trash (at most 60 days)',
    backup: false,
    export: false,
    // A Drive that stays unlinked: the ids go after 60 days, the shelf long since without them.
    prune: (db, now, max) =>
      db.run(
        'DELETE FROM photos_gone WHERE drive_id IN (SELECT drive_id FROM photos_gone WHERE purged_at < ? LIMIT ?)',
        now - 60 * DAY,
        max,
      ),
  },
};
