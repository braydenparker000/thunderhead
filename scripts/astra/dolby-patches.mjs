#!/usr/bin/env node
// Makes tests/fixtures/astra/dolby-patches.webm: Dolby Vision profile 5 colours (IPTPQc2 planes, full
// range, no reshaping) carried by VP9 profile 2, which every test browser decodes, flagged BT.2020 PQ at
// LIMITED range: what the browser takes a real profile 5 HEVC stream for (its full-range IPT codes read
// as limited-range Y'CbCr). 320x180, 1 s. Top row: grey at 5, 20, 100, 203 and 1000 nits. Bottom row, at
// 100 nits a channel: a skin tone, a sky blue and BT.709 green (all inside BT.709), BT.2020 red, and
// BT.709 blue, whose R' the browser clips below 0 (dolby.js), kept to show what cannot be corrected.
//   node scripts/astra/dolby-patches.mjs [out.webm] [--untagged]
// --untagged writes no colour fields at all (the browser then reads BT.601, limited range, 8 bits).
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lightToPlanes, convert, apply } from '../../frontend/astra/src/enhance/dolby.js';

const args = process.argv.slice(2), untagged = args.includes('--untagged');
const out = args.find(a => !a.startsWith('--')) || 'tests/fixtures/astra/dolby-patches.webm';
const from709 = rgb => apply(convert('srgb', 'bt2020'), rgb);
const GREYS = [5, 20, 100, 203, 1000];
const COLOURS = { skin: [80, 55, 42], sky: [35, 55, 85], green709: [0, 100, 0], red2020: null, blue709: [0, 0, 100] };
const light = [...GREYS.map(n => [n, n, n]), ...Object.values(COLOURS).map(c => (c ? from709(c) : [100, 0, 0]))];
const codes = light.map(l => lightToPlanes(l).map(v => Math.min(1023, Math.max(0, Math.round(v * 1024)))));

const W = 320, H = 180, y = new Uint16Array(W * H), u = new Uint16Array(W * H / 4), v = new Uint16Array(W * H / 4);
for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) y[r * W + c] = codes[Math.floor(r / 90) * 5 + Math.floor(c / 64)][0];
for (let r = 0; r < H / 2; r++) for (let c = 0; c < W / 2; c++) { const k = Math.floor(r / 45) * 5 + Math.floor(c / 32); u[r * W / 2 + c] = codes[k][1]; v[r * W / 2 + c] = codes[k][2]; }
const frame = Buffer.concat([y, u, v].map(p => Buffer.from(p.buffer)));
const dir = mkdtempSync(join(tmpdir(), 'dolby-')), raw = join(dir, 'frame.yuv');
writeFileSync(raw, Buffer.concat(Array(24).fill(frame)));
const flags = untagged ? [] : ['-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc', '-color_range', 'tv'];
const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'yuv420p10le', '-s', `${W}x${H}`, '-r', '24', '-i', raw, '-pix_fmt', 'yuv420p10le', ...flags, '-c:v', 'libvpx-vp9', '-profile:v', '2', '-lossless', '1', out], { stdio: 'inherit' });
rmSync(dir, { recursive: true, force: true });
console.log(codes.map(c => c.join('/')).join(' '));
process.exit(r.status ?? 1);
