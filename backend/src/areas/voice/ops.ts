// The voice page (shared/contract/voice.ts), inside a commit. The owner writes it from a device
// whenever they like; the chat mind writes it from its claimed, live session that read no outside
// text, with a why, and its edit is told: a ledger row whose undo brings back the version before,
// and one card from the mind in today's conversation ("I changed how I talk: <why>") with Undo
// and a way into Settings › The mind. The owner's edit and a restore write no message. Every change
// adds a version; none is ever deleted.
import {
  type PutVoiceRequest,
  VOICE_DEFAULT,
  VOICE_LIMITS,
  type VoiceBy,
  type VoiceResponse,
  type VoiceVersion,
  voiceTextProblem,
  voiceWhyProblem,
} from '../../../../shared/contract/voice.ts';
import { uuidv7 } from '../../lib/ids';
import { Fail, invalid } from '../../lib/result';
import type { Db } from '../../objects/base';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { today } from '../conversation/ops';
import * as convo from '../conversation/store';
import { claimedSession } from '../mind/guards';
import * as store from './store';

export const VOICE_UNDO_OPS = ['voice.restore'];
/** What the mind's card in the chat opens: Settings › The mind (frontend th:open). */
export const VOICE_PAGE = 'mind';

/** The page now: the newest version's text, or the default while there is none. */
export const voiceText = (db: Db): string => store.newest(db)?.text ?? VOICE_DEFAULT;

/** GET /v1/mind/voice. */
export function read(db: Db): VoiceResponse {
  const now = store.newest(db);
  return {
    text: now?.text ?? VOICE_DEFAULT,
    last: now ? store.info({ ...now, chars: now.text.length }) : null,
    versions: store.recent(db, VOICE_LIMITS.history).map(store.info),
  };
}

/** GET /v1/mind/voice/:id. */
export function version(db: Db, id: string): VoiceVersion {
  const r = store.byId(db, id);
  if (!r) throw new Fail('not_found');
  return store.full(r);
}

function add(w: Writer, by: VoiceBy, text: string, why: string | null, c: Caller, ledgerId: string | null) {
  const id = uuidv7(w.at);
  store.insert(w.db, { id, at: w.at, by, text, why, session_id: c.session_id, ledger_id: ledgerId });
  w.change('setting', 'voice');
  return id;
}

/** PUT /v1/mind/voice. The same page again writes nothing and answers the page as it is. */
export function put(w: Writer, c: Caller, r: PutVoiceRequest, tz: string): VoiceResponse {
  const mind = c.who === 'C';
  if (!mind && c.who !== 'D') throw new Fail('forbidden');
  if (mind) {
    // Claimed, live, the chat's lease, and no outside text read: else 403.
    if (claimedSession(w.db, c.session_id, 'chat').tainted)
      throw new Fail('session_tainted', { reason: 'a session that read outside text does not change the voice page' });
  }
  const text = r.text.replace(/\s+$/, '');
  const problem = voiceTextProblem(text);
  if (problem) throw invalid('text', problem);
  const why = r.why?.trim() || null;
  if (mind) {
    const bad = voiceWhyProblem(r.why);
    if (bad) throw invalid('why', bad);
  } else if (why && why.length > VOICE_LIMITS.why_max)
    throw invalid('why', `the why has ${why.length} characters (at most ${VOICE_LIMITS.why_max})`);
  const before = store.newest(w.db);
  if ((before?.text ?? VOICE_DEFAULT) === text) return read(w.db);
  if (!mind) {
    add(w, 'owner', text, why, c, null);
    return read(w.db);
  }
  const ledgerId = uuidv7(w.at);
  const after = add(w, 'mind', text, why, c, ledgerId);
  w.ledger({
    id: ledgerId,
    kind: 'arrangement',
    actor: c.actor,
    session_id: c.session_id,
    what: 'changed how I talk (the voice page)',
    why: why as string,
    ref: `voice:${after}`,
    topic_key: 'mind.voice',
    undo: { op: 'voice.restore', args: { before: before?.id ?? null, after } },
  });
  told(w, c, why as string, ledgerId, tz);
  return read(w.db);
}

/** The mind's card in today's conversation: its words, Undo (the ledger row) and Settings › The mind. */
function told(w: Writer, c: Caller, why: string, ledgerId: string, tz: string): void {
  const id = uuidv7(w.at);
  const text = `I changed how I talk: ${why}`;
  convo.insertMessage(w.db, {
    id,
    thread_id: today(w, tz).id,
    author: 'mind',
    origin: 'mind',
    kind: 'card',
    body: text,
    meta: { lines: [{ text, lang: null, ledger: ledgerId, undo: true }], settings: VOICE_PAGE },
    reply_to: null,
    created_at: w.at,
    device_id: null,
    session_id: c.session_id,
    req_sha256: '',
  });
  w.change('message', `msg:${id}`);
}

/** POST /v1/mind/voice/restore (owner devices): that version is the page again, as a new version. */
export function restore(w: Writer, c: Caller, id: string): VoiceResponse {
  if (c.who !== 'D') throw new Fail('forbidden');
  const old = store.byId(w.db, id);
  if (!old) throw new Fail('not_found');
  if (voiceText(w.db) !== old.text) add(w, 'owner', old.text, 'an earlier version again', c, null);
  return read(w.db);
}

/** The undo of the mind's edit (ledger/ops.ts): the version before comes back as a new version,
 * while the mind's is still the page (a later edit stands: 409). */
export function undoVoice(w: Writer, actor: string, args: { before?: string | null; after?: string }): void {
  if (!args.after) throw new Fail('validation', { reason: 'not_undoable' });
  if (store.newest(w.db)?.id !== args.after) throw new Fail('conflict', { reason: 'the voice page changed since' });
  const text = args.before ? store.byId(w.db, args.before)?.text : VOICE_DEFAULT;
  if (text === undefined) throw new Fail('validation', { reason: 'not_undoable' });
  const id = uuidv7(w.at);
  const by: VoiceBy = actor === 'owner' ? 'owner' : 'mind';
  store.insert(w.db, { id, at: w.at, by, text, why: 'undo', session_id: null, ledger_id: null });
  w.change('setting', 'voice');
}
