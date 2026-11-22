// The voice page's rows (migrations.ts): one per version, the newest (highest seq) the page.
import type { VoiceBy, VoiceVersion, VoiceVersionInfo } from '../../../../shared/contract/voice.ts';
import type { Db } from '../../objects/base';

export interface VoiceRow {
  id: string;
  at: number;
  by: VoiceBy;
  text: string;
  why: string | null;
  session_id: string | null;
  ledger_id: string | null;
}

const COLS = 'id, at, by, text, why, session_id, ledger_id';
// The newest is the last added (seq), whatever the clock said.
const ORDER = 'ORDER BY seq DESC';

export const newest = (db: Db) => db.one<VoiceRow>(`SELECT ${COLS} FROM voice_versions ${ORDER} LIMIT 1`) ?? null;

export const byId = (db: Db, id: string) =>
  db.one<VoiceRow>(`SELECT ${COLS} FROM voice_versions WHERE id = ?`, id) ?? null;

/** The newest versions, without their text (its length only). */
export const recent = (db: Db, limit: number) =>
  db.all<Omit<VoiceRow, 'text'> & { chars: number }>(
    `SELECT id, at, by, why, session_id, ledger_id, length(text) AS chars FROM voice_versions ${ORDER} LIMIT ?`,
    limit,
  );

export function insert(db: Db, r: VoiceRow): void {
  db.run(
    `INSERT INTO voice_versions (${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    r.id,
    r.at,
    r.by,
    r.text,
    r.why,
    r.session_id,
    r.ledger_id,
  );
}

export const info = (r: Pick<VoiceRow, 'id' | 'at' | 'by' | 'why'> & { chars: number }): VoiceVersionInfo => ({
  id: r.id,
  at: r.at,
  by: r.by,
  why: r.why,
  chars: r.chars,
});

export const full = (r: VoiceRow): VoiceVersion => ({ ...info({ ...r, chars: r.text.length }), text: r.text });
