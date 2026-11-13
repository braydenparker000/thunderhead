// @ts-check
// The editor's timings to the owner's own storage (API.md §11.27): how long opening a photo, reaching its full-size
// pixels and exporting took on this phone (lab/editor/app/timings.js keeps them; that page reaches nothing
// itself). Home passes them on a while after it opens, at most once in ten minutes and only when there is a new
// one, as one small file in the workshop's folder named editor-timings.json, the one before it removed. So a
// slow step on the real phone can be found without the owner running a test. Off with Settings › Privacy and
// data › Editor timings. Signed in only; a failure waits for the next time home opens.
import { CONFIG } from '/config.js';
import { prefOn } from '/th/pref.js';
import { store } from '/th/session.js';
import { uuidv7 } from '/th/chat/model.js';
import { sha256 } from '/th/attach/upload.js';
import { clean, cleanMarks, due, fileOf } from './timings-core.js';

const KEY = 'th.editor.timings', MARKS = 'th.compare.marks', SENT = 'th.workshop.timings', NAME = 'editor-timings.json';

export async function sendTimings() {
  if (!CONFIG.api || !prefOn('privacy.editor_timings', true)) return;
  let list, marks, sent;
  try {
    list = clean(JSON.parse(localStorage.getItem(KEY) || '[]'));
    marks = cleanMarks(JSON.parse(localStorage.getItem(MARKS) || '[]'));   // the compare page's verdicts ride in the same file
    sent = JSON.parse(localStorage.getItem(SENT) || '{}') || {};
  } catch {
    return;
  }
  const newest = Math.max(0, ...[list[list.length - 1], marks[marks.length - 1]].map((e) => Number(e?.at) || 0));
  if (!due(sent, newest ? [{ at: newest }] : [], Date.now())) return;
  const s = await store.read();
  if (!s) return;
  const nav = /** @type {any} */ (navigator), base = CONFIG.api.replace(/\/+$/, '');
  const body = new Blob([fileOf(list, { build: String(CONFIG.commit).slice(0, 7), agent: navigator.userAgent, cores: navigator.hardwareConcurrency || 0, memory: nav.deviceMemory || 0 }, marks)]);
  const headers = { Authorization: `Bearer ${s.token}`, 'TH-Client': `${CONFIG.build}.${String(CONFIG.commit).slice(0, 7)}` };
  const id = uuidv7();
  const put = await fetch(`${base}/v1/workshop/${id}/parts/1?bytes=${body.size}`, {
    method: 'PUT', body,
    headers: { ...headers, 'Content-Type': 'application/octet-stream', 'TH-File-Name': NAME, 'TH-Sha256': await sha256(body) },
  });
  if (!put.ok) return;
  if (typeof sent.id === 'string') await fetch(`${base}/v1/workshop/${sent.id}`, { method: 'DELETE', headers }).catch(() => {});
  try {
    localStorage.setItem(SENT, JSON.stringify({ id, last: newest, when: Date.now() }));
  } catch {}
}
