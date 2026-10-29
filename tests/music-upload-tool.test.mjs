// The upload tool (scripts/music/upload.py, SETUP.md N4) against the real Worker under wrangler dev:
// a fresh Ed25519 key made with openssl, its public key as the Worker's MUSIC_UPLOAD_PUBLIC_KEYS, a
// tagged Opus file made with ffmpeg. The tool signs and uploads it, registers it, and the owner's
// catalog shows it; the same file again is the same track. Runs where python3 has mutagen and
// ffmpeg, openssl and wrangler are installed (PYTHON names another interpreter); skipped otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { available, setupOwner, startWorker } from '../mind/tests/worker-dev.mjs';

const PYTHON = process.env.PYTHON || 'python3';
const TOOL = fileURLToPath(new URL('../scripts/music/upload.py', import.meta.url));
const has = (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;
const ready =
  available() && has(PYTHON, ['-c', 'import mutagen']) && has('ffmpeg', ['-version']) && has('openssl', ['version']);

test('the tool signs, uploads and registers a song the owner’s catalog then shows; again, the same track', {
  timeout: 240_000,
  skip: ready ? false : 'needs python3 with mutagen, ffmpeg, openssl and wrangler',
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'th-upload-'));
  const key = join(dir, 'music-upload.pem');
  const song = join(dir, 'A Test Song.opus');
  execFileSync('openssl', ['genpkey', '-algorithm', 'ed25519', '-out', key]);
  chmodSync(key, 0o600);
  const der = execFileSync('openssl', ['pkey', '-in', key, '-pubout', '-outform', 'DER']);
  const pub = der.subarray(12).toString('hex');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2',
    '-ac', '2', '-ar', '48000', '-c:a', 'libopus', '-b:a', '24k', '-metadata', 'title=A Test Song',
    '-metadata', 'artist=Test Artist', '-metadata', 'album=Test Album', '-y', song]);
  const w = await startWorker({ vars: { MUSIC_UPLOAD_PUBLIC_KEYS: JSON.stringify([pub]) } });
  try {
    const { device } = await setupOwner(w, []);
    const run = () => {
      const r = spawnSync(PYTHON, [TOOL, song, '--key', key], { env: { ...process.env, TH_API: w.url }, encoding: 'utf8' });
      assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
      return JSON.parse(r.stdout.trim().split('\n').at(-1));
    };
    const first = run();
    assert.equal(first.registered, true);
    assert.equal(first.duplicate, false);
    assert.match(first.id, /^r2_native_[a-f0-9]{64}$/);
    const again = run();
    assert.deepEqual([again.registered, again.duplicate, again.id], [true, true, first.id]);
    const c = await w.call('GET', '/v1/music/catalog', { token: device });
    assert.equal(c.status, 200);
    assert.equal(c.body.count, 1);
    assert.deepEqual(
      [c.body.tracks[0].id, c.body.tracks[0].metadata.title, c.body.tracks[0].metadata.artist, c.body.tracks[0].path],
      [first.id, 'A Test Song', 'Test Artist', 'A Test Song.opus'],
    );
    // A key the Worker doesn't know is refused, and says so without any secret in the answer.
    const other = join(dir, 'other.pem');
    execFileSync('openssl', ['genpkey', '-algorithm', 'ed25519', '-out', other]);
    chmodSync(other, 0o600);
    const refused = spawnSync(PYTHON, [TOOL, song, '--key', other], { env: { ...process.env, TH_API: w.url }, encoding: 'utf8' });
    assert.equal(refused.status, 1);
    assert.match(refused.stdout, /"worker_error_code":"unauthorized"/);
  } finally {
    await w.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
