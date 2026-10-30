// Chat files (HOME.md §4.6, DATA.md): one row per uploaded file; the bytes are in the private
// bucket under chat/files/. Schema step 21.
import type { Migration, TableInfo } from '../../objects/base';

export const FILES_MIGRATIONS: Migration[] = [];

export const FILES_TABLES: Record<string, TableInfo> = {};
