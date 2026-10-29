// The settings area's tables and their retention (DATA.md §10). The SQL is in the P1 base step.
import type { TableInfo } from '../../objects/base';

export const SETTINGS_TABLES: Record<string, TableInfo> = {
  settings: { retention: 'forever', backup: true, export: true },
};
