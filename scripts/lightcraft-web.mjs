// Builds LightCraft's browser app (the whole editor, apps/lightcraft-web in its repository) for the
// test page at /lab/lightcraft/ (engine/lightcraft-web/README.md): LightCraft checked out at the pinned
// commit into engine/lightcraft-web/vendor/lightcraft, our patches applied, `cargo xtask web` run, and
// the files the page loads copied into frontend/lab/lightcraft/ (the site has no build step) with their
// hashes in engine/lightcraft-web/build.json. Two builds: LightCraft's own (`cargo xtask web`: the page
// and, without isolation, its render workers) and threads/ (the `threads` feature with atomics and shared
// memory, for the render workers of a cross-origin isolated page: rayon on Web Workers). Our own
// index.html, boot.js, status.js, worker.js and lightcraft.css there are not built: LightCraft's page uses
// an inline script and style, which our pages' CSP refuses, and its worker knows one module only.
//   node scripts/lightcraft-web.mjs           rebuilds (needs Rust with wasm32-unknown-unknown and rust-src,
//                                              wasm-bindgen-cli at the version in LightCraft's Cargo.lock)
//   node scripts/lightcraft-web.mjs --check    checks the committed files against build.json
// LIGHTCRAFT_GIT names another clone source (a local mirror); the commit is the same either way.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const repo = new URL('..', import.meta.url).pathname;
const home = join(repo, 'engine/lightcraft-web');
const out = join(repo, 'frontend/lab/lightcraft');
const vendor = join(home, 'vendor/lightcraft');
const target = join(home, 'target');
export const LIGHTCRAFT = { git: 'https://github.com/storytold/lightcraft', rev: 'b3b49987d4b2c99f582b80ae91b2ec42ab24d14e' };
const PATCHES = ['web-clock.diff', 'desktop-layout.diff', 'threads.diff'];
/** Built files the page loads; everything else in `out` is ours. */
const BUILT = ['lightcraft_web.js', 'lightcraft_web_bg.wasm', 'snippets', 'threads'];
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const run = (cmd, args, o = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...o })?.trim() ?? '';
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

export function check() {
  const b = JSON.parse(readFileSync(join(home, 'build.json'), 'utf8'));
  const bad = [];
  for (const [file, want] of Object.entries(b.files)) if (!existsSync(join(out, file)) || sha(join(out, file)) !== want.sha256) bad.push(file);
  for (const p of b.patches) if (sha(join(repo, p.file)) !== p.sha256) bad.push(p.file);
  return { build: b, bad };
}

if (process.argv.includes('--check')) {
  const { bad } = check();
  if (bad.length) { console.error(`frontend/lab/lightcraft: ${bad.join(', ')} differ from build.json: rebuild with node scripts/lightcraft-web.mjs`); process.exit(1); }
  console.log('frontend/lab/lightcraft matches build.json');
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const env = { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:/root/.cargo/bin:${process.env.PATH}`, CARGO_TARGET_DIR: target };
  if (!existsSync(join(vendor, '.git'))) run('git', ['clone', '--quiet', '--filter=blob:none', process.env.LIGHTCRAFT_GIT ?? LIGHTCRAFT.git, vendor], { env });
  run('git', ['-C', vendor, 'fetch', '--quiet', 'origin', LIGHTCRAFT.rev], { env });
  run('git', ['-C', vendor, 'checkout', '--quiet', '--force', '--detach', LIGHTCRAFT.rev], { env });
  run('git', ['-C', vendor, 'clean', '-fdq'], { env });
  for (const p of PATCHES) run('git', ['-C', vendor, 'apply', join(home, 'patches', p)], { env });
  const t0 = Date.now();
  // the release build (LightCraft's `web` profile); no Chinese font file, so Chinese-only glyphs show as boxes
  run('cargo', ['xtask', 'web'], { env, cwd: vendor, stdio: ['ignore', 'inherit', 'inherit'] });
  const site = join(target, 'web-site');
  for (const f of BUILT) rmSync(join(out, f), { recursive: true, force: true });
  for (const f of BUILT.filter((b) => b !== 'threads')) cpSync(join(site, f), join(out, f), { recursive: true });
  // threads/: the same crate with rayon on Web Workers, its std rebuilt with atomics (build-std through
  // RUSTC_BOOTSTRAP, so the compiler stays the recorded stable one), shared memory capped at 2 GiB (a shared
  // memory reserves its maximum up front)
  const THREADS = ['-C target-feature=+atomics,+bulk-memory,+mutable-globals', '-C link-arg=--shared-memory', '-C link-arg=--import-memory',
    '-C link-arg=--max-memory=2147483648', ...['__wasm_init_tls', '__tls_size', '__tls_align', '__tls_base'].map((x) => `-C link-arg=--export=${x}`)].join(' ');
  const threadsTarget = join(target, 'threads');
  run('cargo', ['build', '-p', 'lightcraft-web', '--lib', '--target', 'wasm32-unknown-unknown', '--profile', 'web', '--features', 'threads', '-Z', 'build-std=panic_abort,std'],
    { env: { ...env, CARGO_TARGET_DIR: threadsTarget, RUSTC_BOOTSTRAP: '1', RUSTFLAGS: THREADS }, cwd: vendor, stdio: ['ignore', 'inherit', 'inherit'] });
  run('wasm-bindgen', ['--target', 'web', '--no-typescript', '--out-name', 'lightcraft_web', '--out-dir', join(out, 'threads'), join(threadsTarget, 'wasm32-unknown-unknown/web/lightcraft_web.wasm')], { env });
  rmSync(join(out, 'threads/.gitignore'), { force: true });
  const files = {};
  for (const f of BUILT.flatMap((b) => (['snippets', 'threads'].includes(b) ? walk(join(out, b)) : [join(out, b)])).sort()) {
    if (/\.(gz|br)$/.test(f)) { rmSync(f); continue; }
    files[relative(out, f)] = { bytes: readFileSync(f).length, sha256: sha(f) };
  }
  const build = {
    lightcraft: LIGHTCRAFT,
    patches: PATCHES.map((p) => ({ file: `engine/lightcraft-web/patches/${p}`, sha256: sha(join(home, 'patches', p)) })),
    rustc: run('rustc', ['--version'], { env }),
    wasm_bindgen: run('wasm-bindgen', ['--version'], { env }),
    profile: "LightCraft's `web` profile through `cargo xtask web`, no CRAFT_FONTS_DIR, no wasm-opt; threads/: the same profile with --features threads, atomics, bulk-memory, mutable-globals, build-std, shared memory up to 2 GiB",
    files,
  };
  writeFileSync(join(home, 'build.json'), `${JSON.stringify(build, null, 2)}\n`);
  console.log(`built in ${Math.round((Date.now() - t0) / 1000)} s: ${Object.keys(files).length} files`);
}
