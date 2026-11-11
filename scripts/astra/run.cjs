// Each test film played through Astra's lab page in real Chrome: node run.cjs [name filter]
// For each: what Astra decided, whether the picture and the sound really ran, how long the first frame took, what went wrong.
const { chromium } = require('playwright'); const fs = require('fs');
const SITE = process.env.BASE || 'http://127.0.0.1:8080', FILMS = process.env.FILMS || 'http://127.0.0.1:8090', dir = __dirname + '/media', only = process.argv[2] || '';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--headless=new', '--enable-unsafe-webgpu'] });
  const rows = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (only && !new RegExp(only).test(f)) continue;
    const ctx = await b.newContext({ viewport: { width: 800, height: 450 } }), p = await ctx.newPage(), errs = [];
    p.on('pageerror', (e) => errs.push('page: ' + e.message.slice(0, 160))); p.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) errs.push(`${r.status()} ${r.url().replace(SITE, '').slice(0, 90)}`); }); p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
    const t0 = Date.now();
    await p.goto(`${SITE}/astra/lab/?src=${encodeURIComponent(FILMS + '/' + f)}&autoplay=1`).catch((e) => errs.push('goto ' + e.message.slice(0, 80)));
    let st = null, first = 0;
    for (let i = 0; i < 80; i++) {   // up to 20 s
      await p.waitForTimeout(250);
      st = await p.evaluate(() => { const v = document.getElementById('video'), pl = window.astraLab?.player; if (!pl) return null;
        const err = pl.log.filter((x) => x.kind === 'error').map((x) => x.detail?.message + ' / ' + String(x.detail?.detail || '').slice(0, 120));
        return { mode: pl.mode, reason: pl.plan?.reason || '', notes: (pl.plan?.notes || []).join(' | ').slice(0, 200), t: v.currentTime, w: v.videoWidth, rs: v.readyState, paused: v.paused, dur: v.duration, err, fell: !!pl.fellBack,
          audio: (pl.audio || []).map((a) => `${a.label}:${a.delivery || ''}${a.supported === false ? '(no)' : ''}`).join(','), q: v.getVideoPlaybackQuality ? [v.getVideoPlaybackQuality().totalVideoFrames, v.getVideoPlaybackQuality().droppedVideoFrames] : [],
          sound: typeof v.webkitAudioDecodedByteCount === 'number' ? v.webkitAudioDecodedByteCount : -1 }; }).catch(() => null);
      if (st && !first && st.t > 0.05) first = Date.now() - t0;
      if (st && (st.err.length || st.mode === 'unsupported' || st.t > 3.5)) break;
    }
    // a seek back to the start and on to 5 s: does it land and keep playing?
    let seek = '';
    if (st && st.t > 3.5 && !st.err.length) { await p.evaluate(() => { document.getElementById('video').currentTime = 5.5; }); await p.waitForTimeout(2500); const t = await p.evaluate(() => document.getElementById('video').currentTime); seek = t > 5.6 && t < 8.5 ? 'ok' : `stuck at ${t.toFixed(2)}`; }
    // is there really a picture, and does it move? (two looks at the video, half a second apart; a file Chrome plays itself from another origin cannot be looked at, so its frame count stands in)
    const look = () => p.evaluate(() => { const v = document.getElementById('video'), c = document.createElement('canvas'); c.width = 64; c.height = 36; try { const g = c.getContext('2d'); g.drawImage(v, 0, 0, 64, 36); const d = g.getImageData(0, 0, 64, 36).data; let s = 0, h = 0; for (let i = 0; i < d.length; i += 4) { s += d[i] + d[i + 1] + d[i + 2]; h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0; } return [Math.round(s / (64 * 36 * 3)), h]; } catch { return null; } }).catch(() => null);
    const l1 = await look(); await p.waitForTimeout(600); const l2 = await look();
    const picture = !l1 || !l2 ? (st && st.q && st.q[0] > 20 ? 'frames' : 'unseen') : l1[0] < 3 && l2[0] < 3 ? 'BLACK' : l1[1] === l2[1] ? 'STILL' : 'moving';
    const playing = !!st && st.t > 3.5 && (picture === 'moving' || picture === 'frames');
    rows.push({ f, mode: st?.mode || '?', fell: st?.fell ? 'fell back' : '', plays: playing ? 'PLAYS' : st?.mode === 'unsupported' ? 'refused' : 'FAILS', picture, first, t: st ? +st.t.toFixed(1) : 0, frames: st?.q?.join('/') || '', sound: st?.sound, seek, audio: st?.audio || '', why: (st?.err?.[0] || st?.reason || errs.join(' ; ') || '').slice(0, 200) });
    const r = rows.at(-1); console.log(`${r.plays.padEnd(7)} ${f.padEnd(30)} ${String(r.mode).padEnd(11)} ${r.fell.padEnd(9)} ${r.picture.padEnd(7)} first ${String(r.first).padStart(5)} ms  t ${String(r.t).padStart(4)}  frames ${r.frames.padEnd(8)} sound ${String(r.sound).padStart(7)}  seek ${r.seek.padEnd(14)} ${r.audio.slice(0, 40).padEnd(40)} ${r.why}`);
    await ctx.close();
  }
  fs.writeFileSync(__dirname + '/out/matrix.json', JSON.stringify(rows, null, 1));
  console.log(`${rows.filter((r) => r.plays === 'PLAYS').length} play, ${rows.filter((r) => r.plays === 'refused').length} refused, ${rows.filter((r) => r.plays === 'FAILS').length} fail, of ${rows.length}`);
  await b.close();
})();
