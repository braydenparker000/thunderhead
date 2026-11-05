// Photos' RAW engine (engine/photos, frontend/photos/engine): the committed .wasm and its glue match
// the hashes the build recorded, and the built module decodes a real Fujifilm X-E5 RAF (X-Trans 5 HR,
// 40 MP, 14-bit lossy compressed) the way the editor's worker does: streamed into wasm memory, the
// headers and the embedded JPEG, the half-size working copy, a 1:1 tile, under 150 MiB of wasm. The
// sample is raw.pixls.us's public CC0 file, downloaded at test time into a temp directory and never
// committed; offline, the decode test skips and says why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from '../scripts/photos-engine.mjs';

const SAMPLE = {
  url: 'https://raw.pixls.us/getfile.php/8509/nice/Fujifilm%20-%20X-E5%20-%2014bit%20lossy%20compressed%20%283:2%29.RAF',
  sha256: '28f56cc9784164209e92fae209bdcc78267bd692aa2fb964595485f7e93692ab',
};
const ENGINE = new URL('../frontend/photos/engine/', import.meta.url);

test('the committed engine matches its recorded build', () => {
  const { build, bad } = check();
  assert.deepEqual(bad, []);
  assert.equal(build.lightcraft.rev, 'ae7ac42a109e3a18481c916d55516ed60535e49f');
});

/** The CC0 sample in a temp directory (kept there between runs), or why it is not there. */
function sample() {
  const dir = join(tmpdir(), 'th-photos-engine-sample');
  const file = join(dir, 'xe5-8509.raf');
  const ok = () => existsSync(file) && createHash('sha256').update(readFileSync(file)).digest('hex') === SAMPLE.sha256;
  if (ok()) return { file };
  mkdirSync(dir, { recursive: true });
  try {
    execFileSync('curl', ['-sSfL', '--max-time', '180', '-o', file, SAMPLE.url], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    return { why: `offline or the sample host is unreachable (${String(/** @type {Error} */ (e).message).split('\n')[0]})` };
  }
  return ok() ? { file } : { why: 'the downloaded sample does not match its SHA-256' };
}

const got = process.env.TH_OFFLINE ? { why: 'TH_OFFLINE is set' } : sample();
test('decodes the CC0 X-E5 sample: headers, preview, the working copy and a tile in under 150 MiB', { skip: got.why ?? false, timeout: 300_000 }, async () => {
  const { initSync, Engine } = await import(new URL('photos_engine.js', ENGINE).href);
  const wasm = initSync({ module: readFileSync(new URL('photos_engine_bg.wasm', ENGINE)) });
  const bytes = readFileSync(/** @type {string} */ (got.file));
  const e = new Engine();
  const ptr = e.inputPtr(bytes.length, 0);
  for (let at = 0; at < bytes.length; at += 1 << 20)
    new Uint8Array(wasm.memory.buffer, ptr + at, Math.min(1 << 20, bytes.length - at)).set(bytes.subarray(at, at + (1 << 20)));
  const t0 = performance.now();
  const meta = e.decodeInput(true);
  assert.equal(meta.camera, 'FUJIFILM X-E5');
  assert.deepEqual([meta.width, meta.height, meta.cfa, meta.bits, meta.streaming], [7728, 5152, '6x6 x-trans', 14, true]);
  assert.equal(meta.previewJpeg[0], 0xff);
  assert.equal(meta.previewJpeg[1], 0xd8);
  assert.equal(meta.whiteBalance.length, 3);
  // The X-E5 has no bundled matrix in LightCraft's decode crates: the neutral fallback, the file's own white balance.
  assert.equal(meta.matrixIsFallback, true);
  const w = e.working(2);
  const ms = performance.now() - t0;
  assert.deepEqual([w.width, w.height], [3864, 2576]);
  const g = new Uint16Array(wasm.memory.buffer, w.ptr + w.width * w.height * 2, w.width * w.height);
  let sum = 0;
  const f16 = (h) => (h >> 10 === 0 ? 0 : 2 ** ((h >> 10) - 15) * (1 + (h & 1023) / 1024));
  for (let i = 0; i < g.length; i += 97) sum += f16(g[i] & 0x7fff);
  const mean = sum / Math.ceil(g.length / 97);
  assert.ok(mean > 0.005 && mean < 0.9, `green mean ${mean}`);
  // setMatrix re-expresses the working copy in place: the same matrix twice as strong doubles it.
  e.setMatrix(new Float32Array(meta.cameraToRec2020.map((v) => v * 2)));
  const g2 = new Uint16Array(wasm.memory.buffer, w.ptr + w.width * w.height * 2, w.width * w.height);
  let sum2 = 0;
  for (let i = 0; i < g2.length; i += 97) sum2 += f16(g2[i] & 0x7fff);
  assert.ok(Math.abs(sum2 / sum - 2) < 0.01, `×${sum2 / sum}`);
  assert.throws(() => e.setMatrix(new Float32Array(4)));
  e.freeWorking();
  const t = e.tile(3303, 2202, 512, 512);
  assert.deepEqual([t.width, t.height], [512, 512]);
  const mib = e.memoryBytes() / 1048576;
  console.log(`# X-E5 lossy: headers + working copy ${Math.round(ms)} ms, wasm ${mib.toFixed(1)} MiB, as-shot WB ${meta.whiteBalance.map((v) => v.toFixed(3)).join(' ')}`);
  assert.ok(mib < 150, `${mib} MiB of wasm`);
});
