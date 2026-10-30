// @ts-check
// Attachments in the conversation (HOME.md §4.6): photos above the words, two to a row, 120 px tall
// (one alone is wider); a file as a row with its icon, name and size; a voice memo as a row with
// play, its waveform and its length, and its words when the Worker could write them down. The
// bytes come from the Worker with this phone's token (`GET /v1/files/:id`), or from the phone
// itself while the message is still on its way, and are shown as data: images or played through
// Web Audio, so the page's Content-Security-Policy stays as it is. A photo opens full screen; a
// file is saved to the phone. While a file uploads, a ring on it fills.
import { api, signedIn } from '../client.js';
import { toast } from '../ui.js';
import { clock, size } from './state.js';

/** @typedef {import('../../../shared/contract/api.ts').Attachment} Attachment */
/** @typedef {import('./state.js').LocalFile} LocalFile */
/** @typedef {{ id: string, name: string, type: string, bytes: number, seconds?: number, text?: string, thumb?: string }} Item */

/** Bytes this phone already has, by file id: what it sent, and what it fetched. @type {Map<string, Promise<Blob>>} */
const blobs = new Map();
/** @type {Map<string, Promise<string>>} */
const pictures = new Map();

/** @param {string} name */
const icon = (name) => `<svg class="i" aria-hidden="true"><use href="/ui/icons.svg#${name}"/></svg>`;

/** @param {Attachment | LocalFile} a @returns {Item} */
function itemOf(a) {
  if ('ref' in a) return { id: a.ref.replace(/^file:/, ''), name: a.name, type: a.type, bytes: a.bytes, seconds: a.seconds, text: a.text };
  if (!blobs.has(a.id)) blobs.set(a.id, Promise.resolve(a.blob));
  return { id: a.id, name: a.name, type: a.type, bytes: a.bytes, seconds: a.seconds, thumb: a.thumb };
}

/** @param {string} id */
function bytesOf(id) {
  let p = blobs.get(id);
  if (!p) {
    p = signedIn((tok) => api.file(tok, id));
    p.catch(() => blobs.delete(id));
    blobs.set(id, p);
  }
  return p;
}

/** @param {string} id */
function pictureOf(id) {
  let p = pictures.get(id);
  if (!p) {
    p = bytesOf(id).then(
      (b) =>
        new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(r.error);
          r.readAsDataURL(b);
        }),
    );
    p.catch(() => pictures.delete(id));
    pictures.set(id, p);
  }
  return p;
}

/** Fills `host` with the message's attachments. @param {HTMLElement} host @param {(Attachment | LocalFile)[]} list */
export function fill(host, list) {
  const items = list.map(itemOf);
  const photos = items.filter((i) => i.type.startsWith('image/'));
  const rest = items.filter((i) => !i.type.startsWith('image/'));
  if (photos.length) {
    const grid = document.createElement('div');
    grid.className = `pics${photos.length === 1 ? ' one' : ''}`;
    for (const p of photos) grid.append(photo(p));
    host.append(grid);
  }
  for (const i of rest) host.append(i.type.startsWith('audio/') ? memo(i) : file(i));
}

/** @param {Item} i */
function photo(i) {
  const b = Object.assign(document.createElement('button'), { type: 'button', className: 'pic' });
  b.dataset.file = i.id;
  b.setAttribute('aria-label', `Photo: ${i.name}`);
  const img = document.createElement('img');
  img.alt = '';
  if (i.thumb) img.src = i.thumb;
  b.append(img);
  pictureOf(i.id).then(
    (src) => {
      img.src = src;
      b.classList.add('ready');
    },
    () => b.classList.add('lost'),
  );
  b.addEventListener('click', () => view(i));
  return b;
}

/** @param {Item} i */
function file(i) {
  const b = Object.assign(document.createElement('button'), { type: 'button', className: 'frow' });
  b.dataset.file = i.id;
  b.innerHTML = icon('file-text');
  const name = Object.assign(document.createElement('span'), { className: 'fname', textContent: i.name });
  const sz = Object.assign(document.createElement('span'), { className: 'fsize', textContent: size(i.bytes) });
  b.append(name, sz);
  b.setAttribute('aria-label', `Save ${i.name}, ${size(i.bytes)}`);
  b.addEventListener('click', () =>
    bytesOf(i.id).then(
      (blob) => {
        // Saved as plain bytes: a blob keeping its type (an HTML file, an SVG) could run as this
        // page's origin if it were ever opened in place.
        const bytes = new Blob([blob], { type: 'application/octet-stream' });
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(bytes), download: i.name });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
      },
      () => toast("Couldn't fetch that file. Try again."),
    ),
  );
  return b;
}

/** A shared audio context, made on the first play (a page may only start sound from a tap). */
/** @type {AudioContext | null} */
let ctx = null;
/** The memo playing now, stopped when another starts. @type {(() => void) | null} */
let playing = null;
const BARS = 32;
/** Decoded off the page's sound output, so drawing a waveform starts no audio (nor its warnings).
 * @param {ArrayBuffer} a */
const decode = (a) => new OfflineAudioContext(1, 1, 48_000).decodeAudioData(a);

/** @param {Item} i */
function memo(i) {
  const row = document.createElement('div');
  row.className = 'vrow';
  row.dataset.file = i.id;
  const play = Object.assign(document.createElement('button'), { type: 'button', className: 'vplay' });
  play.setAttribute('aria-label', 'Play the voice memo');
  play.innerHTML = icon('play');
  const wave = Object.assign(document.createElement('span'), { className: 'vwave' });
  wave.setAttribute('aria-hidden', 'true');
  const bars = Array.from({ length: BARS }, () => wave.appendChild(document.createElement('i')));
  const len = Object.assign(document.createElement('span'), { className: 'vlen', textContent: clock(i.seconds ?? 0) });
  row.append(play, wave, len);
  /** @type {AudioBuffer | null} */
  let buf = null;
  /** @type {AudioBufferSourceNode | null} */
  let src = null;
  let offset = 0;
  let startedAt = 0;
  let frame = 0;
  const shape = (/** @type {AudioBuffer} */ b) => {
    const data = b.getChannelData(0);
    const step = Math.floor(data.length / BARS) || 1;
    const peaks = bars.map((_, k) => {
      let m = 0;
      for (let j = k * step; j < Math.min(data.length, (k + 1) * step); j += 64) m = Math.max(m, Math.abs(data[j]));
      return m;
    });
    const top = Math.max(...peaks, 0.01);
    bars.forEach((bar, k) => (bar.style.transform = `scaleY(${Math.max(0.12, peaks[k] / top).toFixed(2)})`));
  };
  // The real waveform as soon as the memo scrolls into view (its bytes are small), not a flat row.
  const seen = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    seen.disconnect();
    bytesOf(i.id)
      .then((b) => b.arrayBuffer())
      .then(decode)
      .then((b) => {
        buf ??= b;
        shape(buf);
      })
      .catch(() => {});
  });
  requestAnimationFrame(() => seen.observe(row));
  const show = () => {
    const p = buf ? Math.min(1, (offset + (src && ctx ? ctx.currentTime - startedAt : 0)) / buf.duration) : 0;
    const lit = Math.round(p * BARS);
    bars.forEach((bar, k) => bar.classList.toggle('on', k < lit));
    if (src && ctx && buf) len.textContent = clock(offset + ctx.currentTime - startedAt);
    if (src) frame = requestAnimationFrame(show);
  };
  const pause = () => {
    if (!src || !ctx) return;
    offset += ctx.currentTime - startedAt;
    src.onended = null;
    src.stop();
    src = null;
    cancelAnimationFrame(frame);
    play.innerHTML = icon('play');
    play.setAttribute('aria-label', 'Play the voice memo');
    if (playing === pause) playing = null;
  };
  play.addEventListener('click', async () => {
    if (src) return pause();
    ctx ??= new AudioContext();
    await ctx.resume().catch(() => {});
    /** @type {AudioBuffer} */
    let sound;
    try {
      sound =
        buf ??
        (await bytesOf(i.id)
          .then((b) => b.arrayBuffer())
          .then(decode));
      buf = sound;
    } catch {
      return toast("Couldn't play that memo.");
    }
    shape(sound);
    playing?.();
    if (offset >= sound.duration - 0.05) offset = 0;
    src = ctx.createBufferSource();
    src.buffer = sound;
    src.connect(ctx.destination);
    src.onended = () => {
      src = null;
      offset = 0;
      cancelAnimationFrame(frame);
      bars.forEach((bar) => bar.classList.remove('on'));
      len.textContent = clock(i.seconds ?? buf?.duration ?? 0);
      play.innerHTML = icon('play');
      if (playing === pause) playing = null;
    };
    startedAt = ctx.currentTime;
    src.start(0, offset);
    playing = pause;
    play.innerHTML = icon('pause');
    play.setAttribute('aria-label', 'Pause the voice memo');
    frame = requestAnimationFrame(show);
  });
  if (!i.text) return row;
  const box = document.createElement('div');
  box.className = 'vmemo';
  const words = Object.assign(document.createElement('button'), { type: 'button', className: 'vtext', textContent: i.text });
  words.setAttribute('aria-expanded', 'false');
  words.addEventListener('click', () => words.setAttribute('aria-expanded', String(words.classList.toggle('open'))));
  box.append(row, words);
  return box;
}

/** A photo full screen; a tap, × or Escape closes it. @param {Item} i */
function view(i) {
  const v = document.createElement('div');
  v.className = 'viewer';
  v.setAttribute('role', 'dialog');
  v.setAttribute('aria-modal', 'true');
  v.setAttribute('aria-label', i.name);
  const img = document.createElement('img');
  img.alt = i.name;
  const x = Object.assign(document.createElement('button'), { type: 'button', className: 'vx' });
  x.setAttribute('aria-label', 'Close');
  x.innerHTML = icon('x');
  v.append(img, x);
  pictureOf(i.id).then((src) => (img.src = src), () => toast("Couldn't fetch that photo."));
  const back = /** @type {HTMLElement | null} */ (document.activeElement);
  const close = () => {
    v.classList.remove('in');
    setTimeout(() => v.remove(), 180);
    removeEventListener('keydown', onKey, true);
    back?.focus();
  };
  const onKey = (/** @type {KeyboardEvent} */ e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    close();
  };
  v.addEventListener('click', close);
  addEventListener('keydown', onKey, true);
  document.body.append(v);
  requestAnimationFrame(() => v.classList.add('in'));
  x.focus();
}

// The upload rings (th/attach/upload.js): each picked file's share sent so far.
document.addEventListener('th:upload', (e) => {
  const { id, p } = /** @type {CustomEvent<{ id: string, p: number }>} */ (e).detail;
  for (const n of document.querySelectorAll(`[data-file="${CSS.escape(id)}"]`)) {
    const el = /** @type {HTMLElement} */ (n);
    el.style.setProperty('--up', String(p));
    el.classList.toggle('up', p < 1);
  }
});
