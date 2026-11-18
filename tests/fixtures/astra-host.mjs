// A file host for Astra's browser checks: the small films in tests/fixtures/astra/ served the way a
// real host serves them (byte ranges, readable from another origin), with switches a test can turn
// to make the host misbehave: slow, silent, cutting connections, or gone. It also keeps count of
// what was asked for, how many bytes left and how many requests were open at once at most (a TorBox
// link allows four), so a check can say what a film cost and whether it kept within that.
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('./astra/', import.meta.url));
const TYPES = { '.mkv': 'video/x-matroska', '.mp4': 'video/mp4', '.webm': 'video/webm', '.srt': 'application/x-subrip', '.vtt': 'text/vtt', '.ass': 'text/x-ssa', '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.mpd': 'application/dash+xml', '.m4s': 'video/iso.segment' };
const ALLOW = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Range', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length' };

/**
 * Starts the host. `root` is the folder served (the committed films by default); a test that needs a
 * bigger film makes one elsewhere and passes its folder.
 * Returns {origin, url(name), link(name, label), kill(url, status), control, stats, reset(), close()}.
 *  link(name, label) another address for the same film: /via/<label>/<name> (a renewed link)
 *  kill(url, status) that one address answers `status` (403 by default; 0 brings it back), and the answers it is
 *                   sending now are cut: a link that died
 *  control.hang     true: requests are taken and never answered
 *  control.status   a number: every request answers with it (404, 410, 503…)
 *  control.cutAfter bytes: each answer's connection is destroyed after that many bytes
 *  control.bps      bytes a second per connection (0: as fast as it goes)
 *  control.delay    milliseconds each request waits before it is answered (a far host's round trip)
 *  control.noRange  true: Range is ignored and the whole file sent with 200
 *  control.noCors   true: no CORS headers, so a page on another origin may play the film but not read it
 *                   (a single film: add ?nocors to its address)
 *  control.dead     {path: status}: what kill() sets
 *  control.limit    a number: a request that arrives while that many are open answers 429 (a link's connection limit)
 *  stats            {requests, open, peak, bytes, ranges: [[start, end]…]}: `open` counts the requests being
 *                   answered now, from their arrival to the end of their connection; `peak` its highest
 */
export async function astraHost({ root = ROOT } = {}) {
  const fresh = () => ({ hang: false, status: 0, cutAfter: 0, bps: 0, noRange: false, noCors: false, delay: 0, dead: {}, limit: 0 });
  const control = fresh();
  const stats = { requests: 0, open: 0, peak: 0, bytes: 0, ranges: [] };
  const sending = new Map(); // path -> the answers under way there, for kill()
  const server = http.createServer((req, res) => {
    // A request holds one of the film's connections from its arrival (a delayed or silent one too) until it closes.
    if (req.method !== 'OPTIONS') {
      stats.open++; stats.peak = Math.max(stats.peak, stats.open);
      res.once('close', () => stats.open--);
      req.over = control.limit > 0 && stats.open > control.limit;
    }
    if (control.delay) setTimeout(() => answer(req, res), control.delay); else answer(req, res);
  });
  const answer = (req, res) => {
    const CORS = control.noCors || /[?&]nocors\b/.test(req.url) ? {} : ALLOW; // or for one film alone: its address with ?nocors
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    stats.requests++;
    if (control.hang) return; // the socket stays open and silent
    const path = new URL(req.url, 'http://x').pathname;
    const status = control.status || control.dead[path] || (req.over && 429);
    if (status) { res.writeHead(status, CORS); return res.end(); }
    const file = normalize(join(root, decodeURIComponent(path.replace(/^\/via\/[^/]+\//, '/'))));
    let size;
    try { if (!file.startsWith(root)) throw 0; const s = statSync(file); if (!s.isFile()) throw 0; size = s.size; } catch { res.writeHead(404, CORS); return res.end(); }
    const head = { ...CORS, 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    const m = !control.noRange && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    let start = 0, end = size - 1;
    if (m) {
      start = m[1] ? +m[1] : size - +m[2];
      end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
      if (start >= size) { res.writeHead(416, { ...head, 'Content-Range': `bytes */${size}` }); return res.end(); }
      res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    } else res.writeHead(200, { ...head, 'Content-Length': size });
    stats.ranges.push([start, end]);
    if (req.method === 'HEAD') return res.end();
    if (!sending.has(path)) sending.set(path, new Set());
    sending.get(path).add(res);
    res.once('close', () => sending.get(path).delete(res));
    let sent = 0, pace = null;
    const body = createReadStream(file, { start, end, highWaterMark: 64 * 1024 });
    body.on('data', (chunk) => {
      // A cut sends exactly `cutAfter` bytes and destroys the connection once they have left, as a host that
      // drops connections does; destroyed with bytes still queued here, the cut would race them.
      if (control.cutAfter && sent + chunk.length >= control.cutAfter) {
        const last = chunk.subarray(0, control.cutAfter - sent);
        sent += last.length; stats.bytes += last.length;
        body.destroy();
        return res.write(last, () => res.destroy());
      }
      sent += chunk.length; stats.bytes += chunk.length;
      // The last byte written ends the answer at once, as a real server's does: waiting for the file's end to be
      // read as well left the request counted open after the page had all of it and asked for the next part.
      if (sent >= end - start + 1) { res.end(chunk); return; }
      // The next chunk waits for this one to drain and, with `bps`, for its share of time: both, since a 64 kB
      // chunk always overfills the socket's buffer (write() answers false), which once skipped the pacing.
      body.pause();
      let waits = control.bps ? 2 : 1;
      const go = () => { if (--waits === 0) body.resume(); };
      if (res.write(chunk)) go(); else res.once('drain', go);
      if (control.bps) pace = setTimeout(go, (chunk.length / control.bps) * 1000);
    });
    body.on('end', () => { if (!res.writableEnded) res.end(); });
    body.on('error', () => res.destroy());
    res.on('close', () => { body.destroy(); clearTimeout(pace); }); // a very slow pace's wait must not outlive its answer
  };
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, control, stats,
    url: (name) => `${origin}/${name}`,
    link: (name, label) => `${origin}/via/${label}/${name}`,
    kill(url, status = 403) {
      const path = new URL(url).pathname;
      control.dead[path] = status;
      for (const res of sending.get(path) || []) res.destroy();
    },
    reset() { Object.assign(control, fresh()); Object.assign(stats, { requests: 0, peak: stats.open, bytes: 0, ranges: [] }); },
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}
