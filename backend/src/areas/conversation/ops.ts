// The conversation's behaviour (API.md §11.7, MEMORY.md §11), on top of its store, inside a
// commit. The rules of PUT /v1/messages/:id live here: the thread comes from `day.current`,
// author and origin from the caller, the mind's reply settles earlier owner messages, and the
// files a message names become its attachments (areas/files/ops.ts).
import type { JsonObject, Message, MessageKind, Thread } from '../../../../shared/contract/api';
import { APPS, type AppId, appBuilt } from '../../../../shared/contract/feed.ts';
import { lintMindText } from '../../../../shared/contract/lint.ts';
import { uuidv7 } from '../../lib/ids';
import { Fail, invalid } from '../../lib/result';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { attach } from '../files/ops';
import * as settings from '../settings/store';
import { currentDay, provisionalTitle } from './day';
import * as store from './store';

export interface PutMessage {
  id: string;
  body: string;
  kind?: MessageKind;
  meta?: JsonObject;
  reply_to?: string;
  thread_id?: 'system';
  attachments?: string[];
  req_sha256: string;
}

const AUTHOR = { D: ['owner', 'owner_device'], C: ['mind', 'mind'], N: ['mind', 'mind'], R: ['mind', 'mind'] } as const;

/** Today's open daily thread, made on its first message (the owner never makes one). */
export function today(w: Writer, tz: string): Thread {
  const day = currentDay(w.db, tz, w.at);
  if (settings.getSetting(w.db, 'day.current') === undefined)
    settings.putSetting(w.db, 'day.current', day, 'worker', w.at);
  const found = store.dailyThread(w.db, day);
  if (found) return found;
  const t = store.ensureDaily(w.db, uuidv7(w.at), day, w.at);
  w.change('thread', `thread:${t.id}`);
  return t;
}

/** Returns the stored message and whether this call created it. */
export function putMessage(w: Writer, c: Caller, p: PutMessage, tz: string): { message: Message; created: boolean } {
  const existing = store.messageById(w.db, p.id);
  if (existing) {
    if (existing.req_sha256 !== p.req_sha256) throw new Fail('conflict');
    const { req_sha256: _h, session_id: _s, ...message } = existing;
    return { message, created: false };
  }
  if (c.who === 'M' || c.who === 'I') throw new Fail('forbidden');
  const kind = p.kind ?? 'text';
  if (c.who === 'D' && kind !== 'text' && kind !== 'voice') throw invalid('kind', 'owner messages are text or voice');
  if ((c.who === 'N' || c.who === 'R') && (kind !== 'error' || p.thread_id !== 'system'))
    throw new Fail('forbidden', { reason: 'night and reflex post only kind error to the system thread' });
  if (p.thread_id === 'system' && c.who !== 'N' && c.who !== 'R') throw invalid('thread_id', 'only night and reflex');
  const files = p.attachments ?? [];
  if (files.length && c.who !== 'D' && c.who !== 'C') throw invalid('attachments', 'only the owner and the chat mind');
  if (!p.body && (c.who !== 'D' || !files.length)) throw invalid('body', 'empty: only an owner message with files');
  if (c.who !== 'D') {
    const lint = kind === 'text' || kind === 'question' ? lintMindText(p.body) : null;
    if (lint) throw new Fail('validation', [{ path: 'body', issue: lint }]);
    checkChip(p.meta);
  }
  const thread = today(w, tz);
  if (p.reply_to) {
    // A reply names a message of the open thread, or an owner message still unanswered from an
    // earlier day, so nothing the owner said is lost across the roll.
    const target = store.messageById(w.db, p.reply_to);
    const open = target?.author === 'owner' && target.answered_at === null;
    if (!target || (target.thread_id !== thread.id && !open))
      throw invalid('reply_to', 'not a message in this thread or an unanswered owner message');
  }
  const [author, origin] = AUTHOR[c.who];
  // The files go to this message in its own commit: a refusal leaves both as they were.
  const attachments = files.length ? attach(w.db, files, c.who === 'D' ? 'owner' : 'mind', p.id) : [];
  const message = store.insertMessage(w.db, {
    id: p.id,
    thread_id: thread.id,
    author,
    origin,
    kind,
    body: p.body,
    meta: p.meta ?? null,
    reply_to: p.reply_to ?? null,
    created_at: w.at,
    device_id: c.who === 'D' ? c.device_id : null,
    session_id: c.who === 'D' ? null : c.session_id,
    req_sha256: p.req_sha256,
    attachments,
  });
  if (c.who === 'C') {
    // Any chat post acknowledges what was handed out; a reply settles it and everything before it.
    store.ackHandedOut(w.db, w.at);
    if (p.reply_to) store.answer(w.db, p.reply_to, w.at);
  }
  w.change('message', `msg:${message.id}`);
  const {
    req_sha256: _h,
    session_id: _s,
    ...stored
  } = store.messageById(w.db, message.id) as NonNullable<ReturnType<typeof store.messageById>>;
  return { message: stored as Message, created: true };
}

/** `meta.chip` (API.md §11.7 rule 7): one chip, `app.open` args, path inside that app. */
export function checkChip(meta: JsonObject | undefined): void {
  if (!meta || !('chip' in meta)) return;
  const chip = meta.chip as { label?: unknown; app?: unknown; path?: unknown } | null;
  const ok =
    chip !== null &&
    typeof chip === 'object' &&
    Object.keys(chip).every((k) => k === 'label' || k === 'app' || k === 'path') &&
    typeof chip.label === 'string' &&
    chip.label.length >= 1 &&
    chip.label.length <= 28 &&
    typeof chip.app === 'string' &&
    appBuilt(chip.app) &&
    typeof chip.path === 'string' &&
    chipPath(chip.app as AppId, chip.path) !== null;
  if (!ok) throw invalid('meta.chip', 'one chip: {label ≤ 28, a shipped app, path inside that app}');
}

const BASE = 'https://th.invalid';

/** A chip's path resolved the way the browser resolves it (so "/music/%2e%2e/" is outside Music):
 * the path if it stays inside that app's folder, else null. The phone checks the same way. */
export function chipPath(app: AppId, path: string): string | null {
  if (!path.startsWith('/') || path.includes('..') || /%2f|%5c|\\/i.test(path)) return null;
  let u: URL;
  try {
    u = new URL(path, BASE);
  } catch {
    return null;
  }
  return u.origin === BASE && u.pathname.startsWith(APPS[app].path) ? `${u.pathname}${u.search}${u.hash}` : null;
}

/** PATCH /v1/messages/:id: the mind amends its own posts (keeps cards current). */
export function patchMessage(w: Writer, id: string, body: string | undefined, meta: JsonObject | undefined) {
  const m = store.messageById(w.db, id);
  if (m?.author !== 'mind') throw new Fail('not_found');
  if (body !== undefined) {
    const lint = m.kind === 'text' || m.kind === 'question' ? lintMindText(body) : null;
    if (lint) throw new Fail('validation', [{ path: 'body', issue: lint }]);
  }
  checkChip(meta);
  store.patchMessage(w.db, m.seq, m.body, body, meta, w.at);
  w.change('message', `msg:${id}`);
  const {
    req_sha256: _h,
    session_id: _s,
    ...out
  } = store.messageById(w.db, id) as NonNullable<ReturnType<typeof store.messageById>>;
  return out as Message;
}

export function patchThread(w: Writer, id: string, title: string | undefined, summary: string | undefined): Thread {
  const t = store.thread(w.db, id);
  if (!t) throw new Fail('not_found');
  if (title !== undefined && t.title_source === 'owner')
    throw new Fail('conflict', { reason: 'the owner named this thread' });
  store.patchThread(w.db, id, title, summary, w.at);
  w.change('thread', `thread:${id}`);
  return store.thread(w.db, id) as Thread;
}

/** POST /v1/threads/:id/continue: links a filed thread to today's. */
export function continueThread(w: Writer, id: string, tz: string): { today_thread_id: string } {
  const filed = store.thread(w.db, id);
  if (!filed) throw new Fail('not_found');
  if (filed.status !== 'filed') throw invalid('id', 'only a filed thread can be continued');
  const t = today(w, tz);
  store.linkContinues(w.db, t.id, id, w.at);
  w.change('thread', `thread:${t.id}`);
  return { today_thread_id: t.id };
}

/** The roll (MEMORY.md §11.3): files the open daily threads before `newDay`, gives each a
 * provisional title, and opens `newDay`. Returns the filed thread ids. */
export function roll(w: Writer, newDay: string): string[] {
  const open = store.threadsPage(w.db, 'open', 50, null).filter((t) => t.kind === 'daily' && t.day < newDay);
  for (const t of open) {
    if (!t.title) {
      const first = store.messagesPage(w.db, t.id, null, 0, 20).find((m) => m.author === 'owner');
      const title = provisionalTitle(first?.body ?? null);
      if (title) store.autoTitle(w.db, t.id, title);
    }
    w.change('thread', `thread:${t.id}`);
  }
  store.fileBefore(w.db, newDay, w.at);
  settings.putSetting(w.db, 'day.current', newDay, 'worker', w.at);
  w.change('setting', 'setting:day.current');
  return open.map((t) => t.id);
}
