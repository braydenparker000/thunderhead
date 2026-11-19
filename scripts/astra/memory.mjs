// What a playing film holds in memory, measured: node scripts/astra/memory.mjs <film> [options]
// The film is served from its own folder by tests/fixtures/astra-host.mjs and played by AstraPlayer on the lab page,
// in a Chromium driven over the bare DevTools protocol (cdp.mjs: Playwright's Network domain would keep a copy of every
// download in the page, about 190 MB of a 25 Mbit/s film). Once a second: the renderer's PSS from /proc and the engine's
// own view (buffered ahead and behind, the reader's cache, the budget in force); every --every seconds a memory-infra
// dump of the renderer: V8's heaps (the page's and the workers'), the JS ArrayBuffers (partition_alloc's array_buffer
// partition, every isolate's), the browser's media buffer (media/webmediaplayer/demuxer: what the SourceBuffers hold)
// and Chrome's decoded frames (media/frame_buffers). "Astra's share" is the first three: what Astra decides.
// Options: --play 60 --every 5 --mbit 0 --conn 0 --delay 0 --cpu 1 --audio aac|<track id> --start 0
//          --seek-every 0 (a seek every so many seconds of the sitting, through the film) --switch-every 0 (the next audio
//          track) --rate 1 (playback speed) --memory <GB> (navigator.deviceMemory) --saver (the data saver on)
//          --gc (a collection forced before each dump: what is still held) --before '<js>' --out results.json
// Needs CHROMIUM_PATH (default /opt/pw-browsers/chromium); nothing of the film is written here.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { serve } from '../serve.mjs';
import { astraHost } from '../../tests/fixtures/astra-host.mjs';
import { launch } from './cdp.mjs';

const args = process.argv.slice(2), film = resolve(args[0] || '');
const opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const O = { play: +opt('play', 60), every: +opt('every', 5), mbit: +opt('mbit', 0), conn: +opt('conn', 0), delay: +opt('delay', 0), cpu: +opt('cpu', 1), audio: opt('audio'), start: +opt('start', 0),
  seekEvery: +opt('seek-every', 0), switchEvery: +opt('switch-every', 0), rate: +opt('rate', 1), memory: opt('memory'), saver: args.includes('--saver'), gc: args.includes('--gc'), before: opt('before'), out: opt('out') };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = (x) => x == null ? null : +(x / 1048576).toFixed(1);
const median = (xs) => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : null; };

/** The largest renderer under the browser (the film's page) and its PSS in bytes. */
function renderer(root) {
  const kids = new Map();
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try { const ppid = +readFileSync(`/proc/${d}/stat`, 'utf8').split(') ')[1].split(' ')[1]; if (!kids.has(ppid)) kids.set(ppid, []); kids.get(ppid).push(+d); } catch {}
  }
  let best = { pss: 0, pid: 0 };
  const walk = (p) => {
    for (const k of kids.get(p) || []) {
      try {
        if (readFileSync(`/proc/${k}/cmdline`, 'utf8').includes('--type=renderer')) {
          const pss = +/Pss:\s+(\d+)/.exec(readFileSync(`/proc/${k}/smaps_rollup`, 'utf8'))[1] * 1024;
          if (pss > best.pss) best = { pss, pid: k };
        }
      } catch {}
      walk(k);
    }
  };
  walk(root);
  return best;
}

// In the page before anything runs: an emulated navigator.deviceMemory (--memory), and the element's waits.
const init = (gb) => `${gb ? `Object.defineProperty(Navigator.prototype, 'deviceMemory', {get: () => ${+gb}, configurable: true});` : ''}`;

// The engine's own view, once a second.
function look() {
  const p = window.p, v = p.video, s = p.probed?.source, q = p.session?.queues || {};
  const around = (r) => { const t = v.currentTime; try { for (let i = 0; i < r.length; i++) if (r.start(i) <= t + 0.1 && r.end(i) > t) return [+(t - r.start(i)).toFixed(1), +(r.end(i) - t).toFixed(1)]; } catch {} return [0, 0]; };
  const sum = (it) => { let n = 0; for (const b of it) n += b?.bytes ? b.bytes.length : b?.length || 0; return n; };
  return { t: +v.currentTime.toFixed(1), video: q.video ? around(q.video.buffer.buffered) : null, audio: q.audio ? around(q.audio.buffer.buffered) : null,
    cache: s ? sum(s.blocks.values()) + sum(s.partials.values()) + sum(s.filling) + sum(s.kept || []) : 0, queued: (q.video?.pending() || 0) + (q.audio?.pending() || 0),
    rate: s?.byteRate || 0, budget: p.budget?.name || null, heap: performance.memory?.usedJSHeapSize || null };
}

(async () => {
  if (!/\.(mkv|mp4|webm)$/.test(film)) throw Error('usage: node scripts/astra/memory.mjs <film> [options]');
  const site = await serve(0, {}), base = `http://127.0.0.1:${site.address().port}`;
  const host = await astraHost({ root: dirname(film) + '/' });
  host.control.delay = O.delay;
  let pacer = null;
  if (O.conn) host.control.bps = O.conn;
  else if (O.mbit) pacer = setInterval(() => { host.control.bps = Math.floor(O.mbit * 125000 / Math.max(1, host.stats.open)); }, 25);
  const browser = await launch({ args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-networking', '--window-size=844,390'] });
  const page = await browser.page(`${base}/astra/lab/`, init(O.memory));
  if (O.cpu > 1) await page.send('Emulation.setCPUThrottlingRate', { rate: O.cpu });
  await page.evaluate(async (saver) => {
    const { AstraPlayer } = await import('/astra/src/engine/player.js');
    const video = Object.assign(document.createElement('video'), { playsInline: true });
    video.style.cssText = 'width:844px;height:390px;display:block';
    document.body.append(video);
    const p = window.p = new AstraPlayer(video, document.createElement('div'));
    p.setDataSaver(saver);
    const M = window.__m = { waits: [], errors: [] };
    for (const e of ['waiting', 'playing', 'loadeddata']) video.addEventListener(e, () => M.waits.push([Math.round(performance.now()), e]));
    p.addEventListener('error', (e) => M.errors.push(String(e.detail?.message).slice(0, 160)));
  }, O.saver);
  if (O.before) await page.evaluate(O.before);
  const idle = renderer(browser.pid);
  const url = host.url(basename(film));
  const audioId = O.audio === 'aac' ? await page.evaluate(async (url) => (await import('/astra/src/engine/probe.js')).probe(url).then((r) => { r.source?.close(); return r.info.audio.find((a) => a.codec === 'aac')?.id ?? null; }), url) : O.audio ? +O.audio : null;
  const first = await page.evaluate(([url, start, audioId, rate]) => new Promise((resolve) => {
    const p = window.p, t0 = performance.now();
    p.video.addEventListener('loadeddata', () => { p.video.playbackRate = rate; resolve(Math.round(performance.now() - t0)); }, { once: true });
    p.load({ url, startTime: start, autoplay: true, prefs: audioId != null ? { audioId } : {} });
    setTimeout(() => resolve(null), 60000);
  }), [url, O.start, audioId, O.rate]);
  const rows = [], seeks = [], switches = [];
  const dur = await page.evaluate(() => window.p.video.duration || window.p.info?.duration || 0);
  let lastDump = null;
  for (let i = 1; i <= O.play; i++) {
    await sleep(1000);
    const r = renderer(browser.pid), s = await page.evaluate(look);
    const row = { s: i, pss: MB(r.pss), ...s, cache: MB(s.cache), queued: MB(s.queued), heap: MB(s.heap) };
    if (i % O.every === 0) {
      if (O.gc) await page.send('HeapProfiler.collectGarbage');
      const d = await browser.dump(r.pid);
      const ab = d['partition_alloc/partitions/array_buffer'] || 0, demuxer = d['media/webmediaplayer/demuxer'] || 0, v8 = d.v8 || 0;
      lastDump = { share: MB(v8 + ab + demuxer), v8: MB(v8), ab: MB(ab), demuxer: MB(demuxer), frames: MB(d['media/frame_buffers']), malloc: MB(d.malloc), buffer: MB(d['partition_alloc/partitions/buffer']) };
      Object.assign(row, lastDump);
    }
    rows.push(row);
    if (O.seekEvery && i % O.seekEvery === 0 && dur) {
      const to = +((seeks.length * 0.381966 + 0.1) % 0.95 * dur).toFixed(1); // steps through the whole film, never the same place twice
      seeks.push(await page.evaluate((to) => new Promise((resolve) => {
        const v = window.p.video, t0 = performance.now();
        v.currentTime = to;
        const check = () => { if (!v.seeking && v.readyState >= 3) resolve([to, Math.round(performance.now() - t0)]); else if (performance.now() - t0 > 30000) resolve([to, null]); else setTimeout(check, 20); };
        setTimeout(check, 20);
      }), to));
    }
    if (O.switchEvery && i % O.switchEvery === 0) {
      switches.push(await page.evaluate(async () => {
        const p = window.p, all = p.audioOptions().filter((a) => a.supported), at = all.findIndex((a) => a.selected), next = all[(at + 1) % all.length];
        if (!next || next.selected) return null;
        await p.selectAudio(next.id);
        return next.label;
      }));
    }
    if (i % 10 === 0) console.error(`${i} s: pss ${row.pss} MB, share ${lastDump?.share} (v8 ${lastDump?.v8}, buffers ${lastDump?.ab}, media ${lastDump?.demuxer}, frames ${lastDump?.frames}), ahead ${s.video?.[1]} s, behind ${s.video?.[0]} s, cache ${row.cache} MB`);
  }
  const end = await page.evaluate(() => ({ waits: window.__m.waits, errors: window.__m.errors, log: window.p.log.filter((x) => ['memory', 'stall', 'error', 'resume', 'fallback'].includes(x.kind)).map((x) => x.kind + ' ' + JSON.stringify(x.detail)).slice(-12) }));
  const firstPicture = end.waits.find((w) => w[1] === 'loadeddata')?.[0] ?? 0, stalls = end.waits.filter((w) => w[1] === 'waiting' && w[0] > firstPicture + 500).length;
  const col = (k) => rows.map((r) => r[k]).filter(Number.isFinite), peak = (k) => col(k).length ? Math.max(...col(k)) : null;
  const minutes = [];
  for (let m = 0; m * 60 < rows.length; m++) { const part = rows.slice(m * 60, m * 60 + 60); minutes.push([Math.max(...part.map((r) => r.pss)), Math.max(0, ...part.map((r) => r.share).filter(Number.isFinite))]); }
  const summary = { film: basename(film), mbit: O.mbit, conn: O.conn, delay: O.delay, cpu: O.cpu, audio: O.audio || 'default', memory: O.memory || 'unset', saver: O.saver, rate: O.rate, firstMs: first, idlePss: MB(idle.pss),
    pssPeak: peak('pss'), pssMedian: median(col('pss')), sharePeak: peak('share'), shareMedian: median(col('share')), v8Peak: peak('v8'), abPeak: peak('ab'), abMedian: median(col('ab')), demuxerPeak: peak('demuxer'), demuxerMedian: median(col('demuxer')), framesPeak: peak('frames'), bufferPeak: peak('buffer'),
    aheadMedian: median(rows.map((r) => r.video?.[1])), behindMedian: median(rows.map((r) => r.video?.[0])), cacheMax: peak('cache'), queuedMax: peak('queued'), heapPeak: peak('heap'), budget: rows.at(-1)?.budget,
    stalls, seeks: seeks.length, seekMedianMs: median(seeks.map((x) => x[1])), seekWorstMs: seeks.length ? Math.max(...seeks.map((x) => x[1] ?? Infinity)) : null, switches: switches.filter(Boolean).length, minutes, errors: end.errors, log: end.log };
  console.log(JSON.stringify(summary));
  if (O.out) writeFileSync(O.out, JSON.stringify({ options: O, summary, rows, seeks, switches }, null, 1));
  clearInterval(pacer);
  await browser.close(); site.close(); await host.close();
})().catch((e) => { console.error(e); process.exit(1); });
