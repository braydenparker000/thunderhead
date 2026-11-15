// A file host for Astra's browser checks: the small films in tests/fixtures/astra/ served the way a
// real host serves them (byte ranges, readable from another origin), with switches a test can turn
// to make the host misbehave: slow, silent, cutting connections, or gone. It also keeps count of
// what was asked for and how many bytes left, so a check can say what a film cost.
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
 * Returns {origin, url(name), control, stats, reset(), close()}.
 *  control.hang     true: requests are taken and never answered
 *  control.status   a number: every request answers with it (404, 410, 503…)
 *  control.cutAfter bytes: each answer's connection is destroyed after that many bytes
 *  control.bps      bytes a second per connection (0: as fast as it goes)
 *  control.noRange  true: Range is ignored and the whole file sent with 200
 *  control.noCors   true: no CORS headers, so a page on another origin may play the film but not read it
 *                   (a single film: add ?nocors to its address)
 *  stats            {requests, open, bytes, ranges: [[start, end]…]}
 */
export async function astraHost({ root = ROOT } = {}) {
  const control = { hang: false, status: 0, cutAfter: 0, bps: 0, noRange: false, noCors: false };
  const stats = { requests: 0, open: 0, bytes: 0, ranges: [] };
  const server = http.createServer((req, res) => {
    const CORS = control.noCors || /[?&]nocors\b/.test(req.url) ? {} : ALLOW; // or for one film alone: its address with ?nocors
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    stats.requests++;
    if (control.hang) return; // the socket stays open and silent
    if (control.status) { res.writeHead(control.status, CORS); return res.end(); }
    const file = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
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
    stats.open++;
    let sent = 0, done = false;
    const finish = () => { if (!done) { done = true; stats.open--; } };
    res.on('close', finish);
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
      // The next chunk waits for this one to drain and, with `bps`, for its share of time: both, since a 64 kB
      // chunk always overfills the socket's buffer (write() answers false), which once skipped the pacing.
      body.pause();
      let waits = control.bps ? 2 : 1;
      const go = () => { if (--waits === 0) body.resume(); };
      if (res.write(chunk)) go(); else res.once('drain', go);
      if (control.bps) setTimeout(go, (chunk.length / control.bps) * 1000);
    });
    body.on('end', () => res.end());
    body.on('error', () => res.destroy());
    res.on('close', () => body.destroy());
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, control, stats,
    url: (name) => `${origin}/${name}`,
    reset() { Object.assign(control, { hang: false, status: 0, cutAfter: 0, bps: 0, noRange: false, noCors: false }); Object.assign(stats, { requests: 0, bytes: 0, ranges: [] }); },
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}
