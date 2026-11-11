// The test films, served the way a file host does: byte ranges, and readable from another origin. node serve.cjs <dir> [port]
const http = require('http'), fs = require('fs'), path = require('path');
const dir = path.resolve(process.argv[2] || 'media'), port = +(process.argv[3] || 8090);
const TYPES = { mp4: 'video/mp4', mkv: 'video/x-matroska', webm: 'video/webm', avi: 'video/x-msvideo', ts: 'video/mp2t', mov: 'video/quicktime', flv: 'video/x-flv' };
http.createServer((q, r) => {
  const f = path.join(dir, path.basename(decodeURIComponent(q.url.split('?')[0])));
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Range', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges', 'Accept-Ranges': 'bytes' };
  if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
  fs.stat(f, (e, st) => {
    if (e) { r.writeHead(404, cors); return r.end(); }
    const type = TYPES[f.split('.').pop()] || 'application/octet-stream', m = /bytes=(\d*)-(\d*)/.exec(q.headers.range || '');
    if (!m) { r.writeHead(200, { ...cors, 'Content-Type': type, 'Content-Length': st.size }); return q.method === 'HEAD' ? r.end() : fs.createReadStream(f).pipe(r); }
    const a = m[1] ? +m[1] : st.size - +m[2], b = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
    if (a >= st.size) { r.writeHead(416, { ...cors, 'Content-Range': `bytes */${st.size}` }); return r.end(); }
    r.writeHead(206, { ...cors, 'Content-Type': type, 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Content-Length': b - a + 1 });
    q.method === 'HEAD' ? r.end() : fs.createReadStream(f, { start: a, end: b }).pipe(r);
  });
}).listen(port, () => console.log('films on', port));
