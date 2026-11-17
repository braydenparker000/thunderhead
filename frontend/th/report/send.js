// @ts-check
// The editor's reports to the owner's own storage (API.md §11.27), sent by the background worker (sw.js loads this
// with importScripts; Settings' "Send now" and home load it too): the editor's page reaches nothing itself (its CSP
// allows no other host). Whatever is new in the flight recorder (journal.js) goes, a day's events to one file for this
// phone (`report-<model>-<day>.json`): each send puts up that day's file whole, with the sessions it holds, and removes
// the one it sent of that day before, so the owner's workshop holds one file a phone a day; a file older than 30 days
// is removed. Only signed in, and only where the owner leaves Settings › Privacy and data › Editor reports on (the
// pages tell the recorder: `meta.send`; this worker cannot read the setting itself). A failure keeps everything for the
// next try (the background worker's sync is tried again by the browser, the page closed or not). A plain script (no
// import or export), so the background worker can load it: it sets `thReportSend`.
(() => {
  const DB = 'th-report', KEEP_DAYS = 30, G = /** @type {any} */ (globalThis);
  /** @param {IDBDatabase} d @param {string[]} stores @param {IDBTransactionMode} mode @param {(t: IDBTransaction) => any} f @returns {Promise<any>} */
  const tx = (d, stores, mode, f) => new Promise((resolve) => {
    try { const t = d.transaction(stores, mode), r = f(t); t.oncomplete = () => resolve(r && 'result' in r ? r.result : r); t.onerror = t.onabort = () => resolve(undefined); } catch { resolve(undefined); }
  });
  /** @param {string} name @returns {Promise<IDBDatabase | null>} */
  const open = (name) => new Promise((resolve) => {
    try { const req = indexedDB.open(name); req.onupgradeneeded = () => { req.transaction?.abort(); resolve(null); }; req.onsuccess = () => resolve(req.result); req.onerror = () => resolve(null); } catch { resolve(null); }
  });
  /** The session's token, as the shell keeps it (IndexedDB `th-auth`); null signed out. */
  async function token() {
    const d = await open('th-auth'); if (!d) return null;
    const s = await tx(d, ['kv'], 'readonly', (t) => t.objectStore('kv').get('session')); d.close();
    return typeof s?.token === 'string' ? s.token : null;
  }
  /** The API's address from this site's config.js (written at deploy), or ''. */
  async function api() {
    try { const m = /CONFIG = (\{.*\});/.exec(await (await fetch('/config.js', { cache: 'no-cache' })).text()); return m ? String(JSON.parse(m[1]).api || '').replace(/\/+$/, '') : ''; } catch { return ''; }
  }
  const hex = async (/** @type {Blob} */ b) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await b.arrayBuffer())), (x) => x.toString(16).padStart(2, '0')).join('');
  /** A UUIDv7, as the Worker asks for a file's id. */
  function uuid7() {
    const b = crypto.getRandomValues(new Uint8Array(16)), ms = Date.now();
    for (let i = 0; i < 6; i++) b[i] = Math.floor(ms / 2 ** (8 * (5 - i))) % 256;
    b[6] = (b[6] & 0x0f) | 0x70; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  const day = (/** @type {number} */ at) => new Date(at).toISOString().slice(0, 10);
  const S = /^[0-9a-z]{6,24}$/;
  /** A session as it goes: its known fields only. @param {any} s */
  const session = (s) => ({ id: String(s.id), at: Number(s.at) || 0, build: /^[0-9a-f]{0,12}$/.test(s.build || '') ? s.build : '', cores: Number(s.cores) || 0, memory: Number(s.memory) || 0, closed: s.closed ? 1 : 0, died: s.died ? 1 : 0 });
  let going = /** @type {Promise<{ sent: number, files: number, why?: string }> | null} */ (null);

  /** Sends what is new. `o.force`: whatever the last send, the day's files go again. Gives how many events went, in how many files, or why none. @param {{ force?: boolean }} [o] */
  G.thReportSend = (o = {}) => (going ||= (async () => {
    const F = G.thReportFields;
    const d = await open(DB);
    if (!d || !F) return { sent: 0, files: 0, why: 'nothing kept' };
    try {
      const [send, cursor, files] = await tx(d, ['meta'], 'readonly', (t) => { const m = t.objectStore('meta'), r = [m.get('send'), m.get('cursor'), m.get('files')]; return { get result() { return r.map((x) => x.result); } }; });
      if (send === false) return { sent: 0, files: 0, why: 'switched off' };
      const [tok, base] = await Promise.all([token(), api()]);
      if (!tok || !base) return { sent: 0, files: 0, why: 'signed out' };
      const fresh = (await tx(d, ['events'], 'readonly', (t) => t.objectStore('events').getAll(IDBKeyRange.lowerBound(o.force ? 0 : cursor || 0, true)))) || [];
      if (!fresh.length) return { sent: 0, files: 0, why: 'nothing new' };
      const days = [...new Set(fresh.map((/** @type {any} */ e) => day(e.at)))], kept = /** @type {Record<string, string>} */ ({ ...(files || {}) });
      const all = /** @type {any[]} */ ((await tx(d, ['events'], 'readonly', (t) => t.objectStore('events').getAll())) || []), sessions = /** @type {any[]} */ ((await tx(d, ['sessions'], 'readonly', (t) => t.objectStore('sessions').getAll())) || []);
      const headers = { Authorization: `Bearer ${tok}`, 'TH-Client': 'report.2' };
      let sent = 0, made = 0, top = cursor || 0;
      for (const dd of days) {
        const evs = all.filter((e) => day(e.at) === dd && S.test(e.s)).map((e) => { const { ok } = F.clean(e); return ok && { s: e.s, n: Number(e.n) || 0, at: Number(e.at) || 0, ...ok }; }).filter(Boolean);
        const ids = new Set(evs.map((e) => e.s)), phone = evs.filter((e) => e.kind === 'phone').at(-1), model = String(phone?.model || 'phone').replace(/[^A-Za-z0-9-]/g, '') || 'phone';
        const body = new Blob([JSON.stringify({ v: 2, day: dd, phone: phone ? { model: phone.model || '', android: phone.android || '', cores: phone.cores || 0, memory: phone.memory || 0 } : null, sessions: sessions.filter((s) => ids.has(s.id)).map(session), events: evs })], { type: 'application/json' });
        const id = uuid7(), name = `report-${model}-${dd}.json`;
        const put = await fetch(`${base}/v1/workshop/${id}/parts/1?bytes=${body.size}`, { method: 'PUT', body, headers: { ...headers, 'Content-Type': 'application/octet-stream', 'TH-File-Name': encodeURIComponent(name), 'TH-Sha256': await hex(body) } }).catch(() => null);
        if (!put?.ok) return { sent, files: made, why: 'not sent' };
        if (kept[dd]) await fetch(`${base}/v1/workshop/${kept[dd]}`, { method: 'DELETE', headers }).catch(() => null);   // the day's file before this one
        kept[dd] = id; made++; sent += fresh.filter((/** @type {any} */ e) => day(e.at) === dd).length;
        top = Math.max(top, ...fresh.filter((/** @type {any} */ e) => day(e.at) === dd).map((/** @type {any} */ e) => e.k));
      }
      const old = day(Date.now() - KEEP_DAYS * 86_400_000);   // a month on, a day's file goes
      for (const [dd, id] of Object.entries(kept)) if (dd < old) { await fetch(`${base}/v1/workshop/${id}`, { method: 'DELETE', headers }).catch(() => null); delete kept[dd]; }
      await tx(d, ['meta'], 'readwrite', (t) => { const m = t.objectStore('meta'); m.put(top, 'cursor'); m.put(kept, 'files'); m.put(Date.now(), 'sentAt'); });
      return { sent, files: made };
    } finally { d.close(); }
  })().finally(() => { going = null; }));
})();
