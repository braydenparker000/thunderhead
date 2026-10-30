// The invented scripture table of tests/study/table.json, stored where the Worker reads the owner's
// (STUDY.md §7.1): verse refs are stored only when the table is there.
import { env } from 'cloudflare:workers';
import table from '../../tests/study/table.json';
import { TABLE_KEY } from '../src/areas/library/scripture';

export const storeScripture = () => env.VAULT.put(TABLE_KEY, JSON.stringify(table));
