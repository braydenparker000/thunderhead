// Music's downloads, inside its own service worker (music/sw.js loads this with importScripts after the
// bridge): the owner's own songs saved to the phone's Downloads as they are stored, one song as its file,
// several (a playlist, an album, a selection) as one zip (th/music/zip-stream.js), streamed: nothing is held
// but the song being passed on (and its cover), so a zip of any size costs the phone no memory.
// - The page posts the job ({type: 'th-music-download', job}, with a port for the answer): the song
//   addresses (the player's own), each one's name in the zip, the zip's or file's name, and an .m3u8 to add;
//   for an Opus song its cover's address (the player's, `…/art/<id>`) and the keys the page keeps it under;
//   for an album, the album's cover (the zip's cover.jpg or cover.png).
//   The answer is {id}, or {error}: 'busy' (one job at a time), 'signed-out', 'bad'.
// - Covers (owner, 2026-11-26): an Opus song is saved with its cover embedded (th/music/ogg-cover.js), so
//   other players show it; the cover comes from the phone's covers (library.js) when it is there, else
//   through the bridge, counted as Downloads. No cover, or one that does not load: the song as stored.
//   A cover posted with `crop` (a wide cover the phone shows as its square) is cut to it first, where this
//   worker can draw; where it cannot, the cover goes whole.
//   One song's file has its new exact length; a zip entry's is in its data descriptor as before.
// - The page then navigates to <scope>download/<id>. That navigation is answered here with an attachment
//   (Content-Disposition, the name in UTF-8) whose body is filled as it is read: the browser's own download
//   takes it, with its notification. A response being read keeps this worker running; nothing waits on a timer.
// - Each song comes from the phone when a whole copy is kept there (songs kept from playing them, offline
//   copies: no data spent), else through the bridge's own answer (th/music/bridge.js `answer`), signed and
//   refused exactly as for playback, its bytes counted as Downloads in Settings › Data use.
// - A song that fails is tried once more (from where it broke, by a range); failing again, it is left out
//   (an entry cut short stays, and is named so), and the zip ends with skipped.txt saying what is missing.
// - At the end the page that asked hears {type: 'th-music-download-done', id, ok, missing}.
// Classic script; it names no outside host.
(() => {
  const s = /** @type {any} */ (self);
  if (s.thMusicDownloads) return;
  if (typeof importScripts === 'function') {
    try {
      importScripts('/th/music/zip-stream.js');
    } catch {}
    try {
      importScripts('/th/music/ogg-cover.js');
    } catch {}
  }
  /** The phone's whole copies of songs, by the song's address: played-cache.js, then audio-cache.js. */
  const KEPT = ['claude-player-played', 'claude-player-audio'];
  /** The phone's covers (library.js remoteCover), by its keys: a shared cover's, then the song's address. */
  const COVERS = 'claude-player-covers';
  /** A cover larger than this is not used (the stored ones are at most 2 MiB). */
  const COVER_MAX = 4 * 1024 * 1024;
  /** A job whose download was never asked for (the page went away) is dropped after this. */
  const STALE_MS = 60_000;
  const MAX_FILES = 20_000;
  const AUDIO = /^\/music\/library\/audio\/r2_[A-Za-z0-9_-]{10,200}$/;
  const ART = /^\/music\/library\/art\/r2_[A-Za-z0-9_-]{10,200}$/;
  const enc = new TextEncoder();

  /** The job: {id, at, client, name, zip, files, m3u, missing, started, abort}. One at a time. */
  let job = null;

  // A registration's scope is always an absolute address; without one (a test), Music's own folder.
  const scope = () => (s.registration?.scope ? new URL(s.registration.scope).pathname : '/music/');
  const idOf = (url) => (url.origin === s.location?.origin && url.pathname.startsWith(`${scope()}download/`) ? url.pathname.slice(scope().length + 9) : null);
  const handles = (url) => idOf(url) !== null;
  const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;

  /** A cover as posted ({src, keys}), checked; null when there is none or it is not as it must be. */
  function art(a) {
    let url = null;
    try {
      url = new URL(a?.src);
    } catch {}
    if (!url || url.search || !s.thMusicBridge?.handles(url) || !ART.test(url.pathname)) return null;
    const keys = (Array.isArray(a.keys) ? a.keys : []).filter((k) => text(k, 2000) && URL.canParse?.(k) !== false).slice(0, 4);
    // The square a wide cover is shown as on the phone (music/src/library/cover-fit.js): x, y, w, h as fractions.
    const c = a.crop;
    const crop = Array.isArray(c) && c.length === 4 && c.every((v) => typeof v === 'number' && v >= 0 && v <= 1) && c[2] > 0 && c[3] > 0 && c[0] + c[2] <= 1.0001 && c[1] + c[3] <= 1.0001 ? c : null;
    return { src: url.href, keys: keys.length ? keys : [url.href], ...(crop ? { crop } : {}) };
  }

  /** A cover cut to its square as a JPEG, where the worker can draw (createImageBitmap, OffscreenCanvas); else as it is. */
  async function cropped(c, r) {
    if (typeof s.OffscreenCanvas !== 'function' || typeof s.createImageBitmap !== 'function') return c;
    try {
      const bmp = await s.createImageBitmap(new Blob([c.bytes], c.mime ? { type: c.mime } : {}));
      const W = bmp.width, H = bmp.height;
      // Rounded inward, so none of the filler is kept, and within 3 % of square made square (as the phone cuts
      // it, music/src/library/cover-crop.js cropPixels).
      let sx = Math.max(0, Math.ceil(r[0] * W - 1e-6));
      const sy = Math.max(0, Math.ceil(r[1] * H - 1e-6));
      let w = Math.min(W, Math.floor((r[0] + r[2]) * W + 1e-6)) - sx;
      const h = Math.min(H, Math.floor((r[1] + r[3]) * H + 1e-6)) - sy;
      if (w < 1 || h < 1) return c;
      if (w !== h && Math.abs(w - h) <= 0.03 * h && h <= W) {
        sx = Math.min(W - h, Math.max(0, Math.round((r[0] + r[2] / 2) * W - h / 2)));
        w = h;
      }
      const canvas = new s.OffscreenCanvas(w, h);
      canvas.getContext('2d').drawImage(bmp, sx, sy, w, h, 0, 0, w, h);
      bmp.close?.();
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
      return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg' };
    } catch {
      return c;
    }
  }

  /** A job as posted, checked; null when anything in it is not as it must be. */
  function checked(j) {
    if (!j || !text(j.name, 300) || !Array.isArray(j.files) || !j.files.length || j.files.length > MAX_FILES) return null;
    const files = [];
    for (const f of j.files) {
      let url = null;
      try {
        url = new URL(f?.src);
      } catch {}
      if (!url || url.search || !s.thMusicBridge?.handles(url) || !AUDIO.test(url.pathname) || !text(f.name, 300)) return null;
      files.push({ src: url.href, name: f.name, size: Number(f.size) > 0 ? Number(f.size) : 0, type: text(f.type, 100) ? f.type : 'application/octet-stream', art: art(f.art) });
    }
    const m3u = j.m3u && text(j.m3u.name, 300) && typeof j.m3u.text === 'string' ? { name: j.m3u.name, text: j.m3u.text } : null;
    const zip = j.zip === true || files.length > 1;
    return { name: j.name, zip, files, m3u, missing: Math.max(0, Math.floor(Number(j.missing) || 0)), cover: zip ? art(j.cover) : null };
  }

  /** Whether the page asking may have the session: top-level, or a frame home opened (as the bridge's rule). */
  const ours = async (source) => source?.frameType === 'top-level' || (!!s.thFrames && !!source?.id && (await s.thFrames.trusted(source.id)));

  async function start(data, source, port) {
    const say = (m) => port?.postMessage(m);
    if (job && !job.done && (job.started || Date.now() - job.at < STALE_MS)) return say({ error: 'busy' });
    const j = checked(data);
    if (!j || !s.thZipStream) return say({ error: 'bad' });
    if (!(await ours(source)) || !(await s.thMusicBridge.deps.token())) return say({ error: 'signed-out' });
    if (job && !job.done && (job.started || Date.now() - job.at < STALE_MS)) return say({ error: 'busy' });
    const id = (s.crypto?.randomUUID?.() ?? String(Math.random()).slice(2) + Date.now()).replace(/-/g, '');
    job = { ...j, id, at: Date.now(), client: source.id, started: false, done: false, abort: new AbortController(), covers: new Map() };
    say({ id });
  }

  s.addEventListener?.('message', (e) => {
    if (e.data?.type !== 'th-music-download') return;
    e.waitUntil?.(start(e.data.job, e.source, e.ports?.[0]).catch(() => e.ports?.[0]?.postMessage({ error: 'bad' })));
  });

  /** A whole copy of the song kept on the phone, or null. */
  async function kept(f) {
    for (const name of KEPT) {
      try {
        if (!(await s.caches.has(name))) continue;
        const r = await (await s.caches.open(name)).match(f.src, { ignoreVary: true });
        const len = Number(r?.headers.get('Content-Length') ?? NaN);
        if (r?.ok && r.body && (!f.size || !Number.isFinite(len) || len === f.size)) return r;
      } catch {}
    }
    return null;
  }

  /** The song from `at` on, through the bridge (as playback asks for it), counted as Downloads. */
  function fetched(f, at, j) {
    const req = new Request(f.src, { headers: at ? { Range: `bytes=${at}-` } : {}, signal: j.abort.signal });
    return s.thMusicBridge.answer(req, { clientId: j.client, part: 'music.downloads' });
  }

  /** A body's bytes, or null past `max`. @param {Response} r */
  async function bytesOf(r, max) {
    if (Number(r.headers.get('Content-Length')) > max) {
      r.body?.cancel().catch(() => {});
      return null;
    }
    const parts = [];
    let n = 0;
    for await (const c of chunks(r.body)) {
      n += c.length;
      if (n > max) return null;
      parts.push(c);
    }
    const out = new Uint8Array(n);
    let at = 0;
    for (const c of parts) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }

  /** A cover's bytes and type: the phone's copy (or its "no cover"), else through the bridge; null when there is none. */
  async function coverBytes(a, j) {
    try {
      if (await s.caches.has(COVERS)) {
        const store = await s.caches.open(COVERS);
        for (const k of a.keys) {
          const hit = await store.match(k, { ignoreVary: true }).catch(() => null);
          if (!hit) continue;
          if (hit.headers.get('x-cover-none') || !hit.ok) return null;
          const bytes = await bytesOf(hit, COVER_MAX);
          if (bytes?.length) return { bytes, mime: hit.headers.get('Content-Type') || '' };
        }
      }
    } catch {}
    try {
      const r = await s.thMusicBridge.answer(new Request(a.src, { signal: j.abort.signal }), { clientId: j.client, part: 'music.downloads' });
      if (r.status !== 200 || !r.body) {
        r.body?.cancel().catch(() => {});
        return null;
      }
      const bytes = await bytesOf(r, COVER_MAX);
      return bytes?.length ? { bytes, mime: r.headers.get('Content-Type') || '' } : null;
    } catch {
      return null;
    }
  }

  /**
   * A cover for the job, read once however many songs share it (an album's do: the same keys first), the last
   * few kept: {bytes, mime, block} (block: the FLAC picture to embed), or null. Never throws.
   */
  function coverOf(a, j) {
    const key = a.crop ? `${a.keys[0]}#${a.crop.join()}` : a.keys[0];
    let p = j.covers.get(key);
    if (!p) {
      p = (async () => {
        const read = await coverBytes(a, j);
        const c = read && a.crop ? await cropped(read, a.crop) : read;
        if (!c || !s.thOggCover) return c && { ...c, block: null };
        const fit = await s.thOggCover.fitCover(c.bytes, c.mime).catch(() => null);
        return { ...c, mime: s.thOggCover.imageInfo(c.bytes, c.mime).mime, block: fit ? s.thOggCover.pictureBlock(fit) : null };
      })().catch(() => null);
      j.covers.set(key, p);
      while (j.covers.size > 3) j.covers.delete(j.covers.keys().next().value);
    }
    return p;
  }

  /** The song's bytes with its cover embedded (an Opus song that has one); else as stored. `f.added`: the bytes it grows by. */
  async function* withCover(f, j) {
    const c = f.art && s.thOggCover ? await coverOf(f.art, j) : null;
    if (!c?.block) {
      yield* song(f, j);
      return;
    }
    const e = new s.thOggCover.Embedder(c.block);
    for await (const chunk of song(f, j)) {
      for (const o of e.push(chunk)) {
        f.added = e.added;
        if (o.length) yield o;
      }
    }
    for (const o of e.end()) if (o.length) yield o;
  }

  /** A body's chunks. @param {ReadableStream<Uint8Array>} body */
  async function* chunks(body) {
    const reader = body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        if (value?.length) yield value;
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  }

  /**
   * A song's bytes, in order: the phone's copy, else the bridge's, tried once more on a failure (from the
   * byte where it broke); throws when that fails too. `f.length` is set from the first answer when known.
   */
  async function* song(f, j) {
    const copy = await kept(f);
    if (copy) {
      f.length = Number(copy.headers.get('Content-Length')) || null;
      yield* chunks(copy.body);
      return;
    }
    let at = 0;
    let tries = 0;
    for (;;) {
      let r = null;
      try {
        r = await fetched(f, at, j);
      } catch {}
      const whole = r?.status === 200 && at === 0;
      const rest = r?.status === 206 && new RegExp(`^bytes ${at}-`).test(r.headers.get('Content-Range') ?? '');
      if (r?.body && (whole || rest)) {
        if (at === 0) f.length = whole ? Number(r.headers.get('Content-Length')) || null : null;
        try {
          for await (const c of chunks(r.body)) {
            at += c.length;
            yield c;
          }
          return;
        } catch {}
      } else r?.body?.cancel().catch(() => {});
      if (j.abort.signal.aborted || ++tries > 1) throw new Error('song');
    }
  }

  /** The .m3u8 without the entries of songs left out (a name line and the directive lines before it). */
  function without(m3u, gone) {
    if (!gone.size) return m3u;
    const lines = m3u.split(/\r?\n/);
    const out = [];
    let held = [];
    for (const line of lines) {
      if (line.startsWith('#EXT') && line !== '#EXTM3U') held.push(line);
      else {
        if (!gone.has(line)) out.push(...held, line);
        held = [];
      }
    }
    return out.join('\r\n');
  }

  /** The zip's records and the songs' bytes, in order; the result in `j.result`. */
  async function* zipped(j) {
    const z = new s.thZipStream.ZipWriter();
    const left = [];
    let added = 0;
    for (const f of j.files) {
      if (j.abort.signal.aborted) return;
      const it = withCover(f, j);
      let first;
      try {
        first = await it.next();
      } catch {
        left.push(f.name);
        continue;
      }
      yield z.begin(f.name);
      if (!first.done) yield z.data(first.value);
      let cut = false;
      try {
        for (;;) {
          const n = await it.next();
          if (n.done) break;
          yield z.data(n.value);
        }
      } catch {
        cut = true;
      }
      yield z.end();
      if (cut) left.push(`${f.name} (cut short)`);
      else added++;
    }
    // An album's cover, as stored, beside its songs.
    const cover = j.cover && added ? await coverOf(j.cover, j) : null;
    if (cover?.bytes.length) {
      yield z.begin(`cover.${cover.mime === 'image/png' ? 'png' : 'jpg'}`);
      yield z.data(cover.bytes);
      yield z.end();
    }
    if (j.m3u) {
      yield z.begin(j.m3u.name);
      yield z.data(enc.encode(without(j.m3u.text, new Set(left.map((n) => n.replace(/ \(cut short\)$/, ''))))));
      yield z.end();
    }
    if (left.length || j.missing) {
      const lines = ['These songs could not be added:', ...left];
      if (j.missing) lines.push(`${j.missing} ${j.missing === 1 ? 'song is' : 'songs are'} no longer in the library.`);
      yield z.begin('skipped.txt');
      yield z.data(enc.encode(`${lines.join('\r\n')}\r\n`));
      yield z.end();
    }
    yield z.finish();
    j.result = { ok: added > 0 || !j.files.length, missing: left.length + j.missing };
  }

  /** The page that asked hears how it ended (or, gone, any of Music's pages). */
  async function done(j, ok, missing = 0) {
    if (j.done) return;
    j.done = true;
    if (job === j) job = null;
    const msg = { type: 'th-music-download-done', id: j.id, ok, missing };
    const to = (await s.clients.get(j.client).catch(() => null)) ?? null;
    if (to) return to.postMessage(msg);
    for (const c of await s.clients.matchAll({ type: 'window' }).catch(() => [])) c.postMessage(msg);
  }

  /** A body filled from `it` as it is read; the end (or the reader letting go) ends the job. */
  function stream(j, it, first = null) {
    let head = first;
    return new ReadableStream(
      {
        async pull(c) {
          try {
            if (head) {
              c.enqueue(head);
              head = null;
              return;
            }
            for (;;) {
              const n = await it.next();
              if (n.done) {
                c.close();
                const r = j.result ?? { ok: true, missing: 0 };
                await done(j, r.ok, r.missing);
                return;
              }
              if (n.value?.length) return c.enqueue(n.value);
            }
          } catch (e) {
            c.error(e);
            j.abort.abort();
            await done(j, false);
          }
        },
        cancel() {
          j.abort.abort();
          it.return?.().catch?.(() => {});
          done(j, false);
        },
      },
      { highWaterMark: 0 },
    );
  }

  /** `filename*` in UTF-8, and a plain fallback. */
  const disposition = (name) => `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;

  /** The answer to the download's navigation. Anything not ours to start is a 204: the page stays as it is. */
  async function answer(event) {
    const id = idOf(new URL(event.request.url));
    const j = job;
    if (!j || j.id !== id || j.started || j.done) return new Response(null, { status: 204 });
    j.started = true;
    const headers = { 'Content-Disposition': disposition(j.name), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (j.zip) return new Response(stream(j, zipped(j)), { headers: { ...headers, 'Content-Type': 'application/zip' } });
    // One song: its bytes (with its cover), its length when known, once the first of them is here (the cover's
    // header written by then: the stored length and what it added).
    const f = j.files[0];
    const it = withCover(f, j);
    try {
      const first = await it.next();
      if (first.done) {
        await done(j, true);
        return new Response(new Uint8Array(0), { headers: { ...headers, 'Content-Type': f.type, 'Content-Length': '0' } });
      }
      if (f.length) headers['Content-Length'] = String(f.length + (f.added || 0));
      return new Response(stream(j, it, first.value), { headers: { ...headers, 'Content-Type': f.type } });
    } catch {
      await done(j, false);
      return new Response(null, { status: 204 });
    }
  }

  s.thMusicDownloads = { handles, answer, start, checked, without, cropped, get job() { return job; } };
})();
