// Reminders the owner sets (HOME.md §6.2, BEHAVIOR.md §3.4): one row each, delivered once by
// Core's alarm. Schema step 22.
import type { Migration, TableInfo } from '../../objects/base';

export const REMINDERS_MIGRATIONS: Migration[] = [];

export const REMINDERS_TABLES: Record<string, TableInfo> = {};
