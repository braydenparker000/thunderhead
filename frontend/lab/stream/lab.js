// @ts-check
// The stream lab (docs/process/NEXT-BATCH.md part 2; MUSIC.md §5): a short queue through Music's
// streaming feeder (th/music/stream/feed.js) in one audio element. It shows what the feeder does:
// seconds buffered ahead against the cap, each song's start on the element's timeline and the
// gap after the song before it, stalls, retries and a fallback, which it follows by playing on in
// the plain element as the player would. Signed in, it plays three of the owner's Opus songs (or
// ?ids=a,b,c), each link signed by POST /v1/media/sign as th/music/bridge.js does; locally, the
// same-site files named in ?src=. Song ids only on screen; nothing is sent anywhere but the API.
import { api, configured } from '/th/client.js';
import { store } from '/th/session.js';
import { CAP_S, StreamFeed, supported } from '/th/music/stream/feed.js';

/** @typedef {import('/th/music/stream/track.js').StreamTrack} StreamTrack */
/** @typedef {import('../../../shared/contract/music.ts').MusicCatalog} MusicCatalog */
/** @typedef {import('../../../shared/contract/music.ts').MediaSignResponse} MediaSignResponse */

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const audio = /** @type {HTMLAudioElement} */ ($('audio'));
const buttons = ['play', 'pause', 'back', 'fwd', 'next'].map((id) => /** @type {HTMLButtonElement} */ ($(id)));
const params = new URLSearchParams(location.search);
/** A link signed less than this long before it expires is signed again (MUSIC.md §6.1). */
const RESIGN_MS = 20 * 60_000;

/** @param {string} text */
function log(text) {
  const li = document.createElement('li');
  li.textContent = text;
  $('log').append(li);
}
const short = (/** @type {string} */ id) => (id.length > 18 ? `${id.slice(0, 18)}…` : id);
const clock = (/** @type {number} */ ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/** Same-site paths only: a crafted link can't point the lab at another host. @param {string} s */
const local = (s) => s.startsWith('/') && !s.startsWith('//');

/** @returns {Promise<{ how: string, tracks: (StreamTrack & { id: string })[] } | null>} */
async function queue() {
  const src = (params.get('src') ?? '').split(',').filter(local);
  if (src.length) return { how: 'the files named in the address', tracks: src.map((u) => ({ id: u.split('/').pop() ?? u, url: () => u })) };
  if (!configured) return null;
  const session = await store.read();
  if (!session) return null;
  const token = session.token;
  /** @type {MusicCatalog} */
  const catalog = await api.call('/v1/music/catalog', { token });
  const opus = catalog.tracks.filter((t) => /\.opus$/.test(String(t.audioKey ?? '')));
  const asked = (params.get('ids') ?? '').split(',').filter(Boolean);
  const picked = asked.length ? opus.filter((t) => asked.includes(t.id)) : opus.sort(() => Math.random() - 0.5).slice(0, 3);
  /** @type {Map<string, { url: string, expires_at: number }>} */
  const links = new Map();
  /** @param {string[]} refs */
  const sign = async (refs) => {
    /** @type {MediaSignResponse} */
    const r = await api.call('/v1/media/sign', { method: 'POST', token, body: { refs } });
    for (const item of r.items) links.set(item.ref, { url: item.url, expires_at: item.expires_at });
  };
  await sign(picked.map((t) => `music:${t.id}`));
  return {
    how: 'three of your songs',
    tracks: picked.map((t) => {
      const ref = `music:${t.id}`;
      const meta = /** @type {{ dur?: number }} */ (t.metadata ?? {});
      return {
        id: t.id,
        bytes: typeof t.size === 'number' ? t.size : undefined,
        durationMs: typeof meta.dur === 'number' ? Math.round(meta.dur * 1000) : undefined,
        url: async (/** @type {boolean | undefined} */ fresh) => {
          const had = links.get(ref);
          if (fresh || !had || had.expires_at - Date.now() < RESIGN_MS) await sign([ref]);
          const link = links.get(ref);
          if (!link) throw new Error('not signed');
          return link.url;
        },
      };
    }),
  };
}

async function main() {
  if (!supported()) return void ($('state').textContent = 'This browser can’t stream Opus through Media Source Extensions; the player would use its plain element.');
  let q;
  try {
    q = await queue();
  } catch (e) {
    return void ($('state').textContent = `Couldn’t get songs (${/** @type {{ code?: string }} */ (e).code ?? 'error'}).`);
  }
  if (!q || !q.tracks.length) return void ($('state').textContent = 'Sign in on this site to play your songs, or name same-site files: ?src=/a.opus,/b.opus');
  const { tracks } = q;
  $('state').textContent = `Playing ${q.how}: ${tracks.map((t) => short(t.id)).join(', ')}.`;
  const feed = new StreamFeed(audio);
  const t0 = performance.now();
  const at = () => `${((performance.now() - t0) / 1000).toFixed(1)} s`;
  /** @type {Map<number, number>} where each song ended on the element's timeline (s) */
  const ends = new Map();
  let most = 0;
  /** @param {string} type @param {(d: any) => void} fn */
  const on = (type, fn) => feed.addEventListener(type, (e) => fn(/** @type {CustomEvent} */ (e).detail));
  on('trackstart', (d) => {
    const before = ends.get(d.index - 1);
    const gap = before === undefined ? '' : ` · gap ${((d.at - before) * 1000).toFixed(1)} ms after song ${d.index}`;
    log(`${at()}  song ${d.index + 1} (${short(tracks[d.index].id)}) started at ${d.at.toFixed(3)} s${gap} · heard ${d.late} ms after`);
  });
  on('trackend', (d) => {
    ends.set(d.index, d.at);
    log(`${at()}  song ${d.index + 1} ended at ${d.at.toFixed(3)} s`);
  });
  on('ahead', (d) => {
    most = Math.max(most, d.seconds);
    $('fill').style.transform = `scaleX(${Math.min(1, d.seconds / 20)})`;
    $('nums').textContent = `${d.seconds.toFixed(1)} s buffered ahead · cap ${CAP_S} s · most so far ${most.toFixed(1)} s`;
  });
  on('stall', (d) => log(`${at()}  stalled in song ${d.index + 1} at ${clock(d.ms)}`));
  on('error', (d) => log(`${at()}  ${d.code}, trying again (${d.attempt})`));
  on('ended', () => log(`${at()}  the queue played out`));
  on('fallback', async (d) => {
    log(`${at()}  fell back (${d.reason}) in song ${d.index + 1} at ${clock(d.ms)}: playing on in the plain element`);
    feed.destroy();
    const track = tracks[Math.max(0, d.index)];
    audio.src = await track.url();
    audio.addEventListener('loadedmetadata', () => (audio.currentTime = d.ms / 1000), { once: true });
    audio.play().catch(() => {});
  });
  audio.addEventListener('timeupdate', () => {
    const p = feed.position();
    if (p.index >= 0) $('now').textContent = `Song ${p.index + 1} of ${tracks.length} · ${clock(p.ms)} / ${clock(p.durationMs)} · ${short(tracks[p.index].id)}`;
  });
  feed.load(tracks);
  const [play, pause, back, fwd, next] = buttons;
  play.addEventListener('click', () => audio.play().catch(() => {}));
  pause.addEventListener('click', () => audio.pause());
  back.addEventListener('click', () => feed.seek(Math.max(0, feed.position().ms - 10_000)));
  fwd.addEventListener('click', () => feed.seek(feed.position().ms + 30_000));
  next.addEventListener('click', () => feed.skip());
  for (const b of buttons) b.disabled = false;
  audio.play().catch(() => log('Tap Play to start.'));
}

main();
