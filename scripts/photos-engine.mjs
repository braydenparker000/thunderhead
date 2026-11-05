// Builds Photos' RAW engine (engine/photos, README there) into frontend/photos/engine/, the files the
// site serves as they are (it has no build step): LightCraft checked out at the pinned commit into
// engine/photos/vendor/lightcraft, our memory patches applied, the crate built for wasm32 and bound
// with wasm-bindgen, and the hashes written to engine/photos/build.json. Two builds: plain wasm32 (one thread,
// every page) and `threads/` (shared memory and a rayon pool on Web Workers, for the cross-origin isolated
// editor: the same rustc with its own std rebuilt with atomics, build-std through RUSTC_BOOTSTRAP).
//   node scripts/photos-engine.mjs           rebuilds (needs Rust with wasm32-unknown-unknown and rust-src,
//                                             wasm-bindgen-cli 0.2.129; WASM_BINDGEN names its path)
//   node scripts/photos-engine.mjs --check    checks the committed .wasm and glue against build.json
// LIGHTCRAFT_GIT names another clone source (a local mirror); the commit is the same either way.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const repo = new URL('..', import.meta.url).pathname;
const crate = join(repo, 'engine/photos');
const out = join(repo, 'frontend/photos/engine');
const vendor = join(crate, 'vendor/lightcraft');
export const LIGHTCRAFT = { git: 'https://github.com/storytold/lightcraft', rev: 'ae7ac42a109e3a18481c916d55516ed60535e49f' };
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const run = (cmd, args, o = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...o })?.trim() ?? '';

export function check() {
  const b = JSON.parse(readFileSync(join(crate, 'build.json'), 'utf8'));
  const bad = [];
  for (const [file, want] of Object.entries(b.files)) if (sha(join(out, file)) !== want.sha256) bad.push(file);
  return { build: b, bad };
}

if (process.argv.includes('--check')) {
  const { bad } = check();
  if (bad.length) { console.error(`frontend/photos/engine: ${bad.join(', ')} differ from build.json: rebuild with node scripts/photos-engine.mjs`); process.exit(1); }
  console.log('frontend/photos/engine matches build.json');
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const env = { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:/root/.cargo/bin:${process.env.PATH}` };
  if (!existsSync(join(vendor, '.git'))) run('git', ['clone', '--quiet', process.env.LIGHTCRAFT_GIT ?? LIGHTCRAFT.git, vendor], { env });
  run('git', ['-C', vendor, 'checkout', '--quiet', '--force', '--detach', LIGHTCRAFT.rev], { env });
  run('git', ['-C', vendor, 'clean', '-fdq'], { env });
  run('git', ['-C', vendor, 'apply', join(crate, 'patches/lightcraft-memory.diff')], { env });
  const t0 = Date.now();
  const bindgen = process.env.WASM_BINDGEN ?? 'wasm-bindgen';
  const cargo = ['build', '--release', '--locked', '--target', 'wasm32-unknown-unknown', '--manifest-path', join(crate, 'Cargo.toml')];
  // shared memory capped at 1 GiB (a shared memory reserves its maximum up front), and the exports wasm-bindgen's
  // thread start needs
  const THREADS = '-C target-feature=+atomics,+bulk-memory,+mutable-globals -C link-arg=--shared-memory -C link-arg=--import-memory -C link-arg=--max-memory=1073741824 -C link-arg=--export=__wasm_init_tls -C link-arg=--export=__tls_size -C link-arg=--export=__tls_align -C link-arg=--export=__tls_base';
  const variants = [
    { dir: out, args: [], env },
    { dir: join(out, 'threads'), args: ['--features', 'threads', '-Z', 'build-std=panic_abort,std', '--target-dir', join(crate, 'target/threads')],
      env: { ...env, RUSTC_BOOTSTRAP: '1', RUSTFLAGS: THREADS } },
  ];
  for (const v of variants) {
    run('cargo', [...cargo, ...v.args], { env: v.env, stdio: ['ignore', 'inherit', 'inherit'] });
    const target = v.args.includes('--target-dir') ? join(crate, 'target/threads') : join(crate, 'target');
    if (v.dir !== out) rmSync(v.dir, { recursive: true, force: true });
    run(bindgen, ['--target', 'web', '--no-typescript', '--out-dir', v.dir, '--out-name', 'photos_engine', join(target, 'wasm32-unknown-unknown/release/photos_engine.wasm')], { env });
    rmSync(join(v.dir, '.gitignore'), { force: true });
  }
  const files = {};
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  for (const f of walk(out).sort()) files[relative(out, f)] = { bytes: readFileSync(f).length, sha256: sha(f) };
  const build = {
    lightcraft: LIGHTCRAFT,
    patch: { file: 'engine/photos/patches/lightcraft-memory.diff', sha256: sha(join(crate, 'patches/lightcraft-memory.diff')) },
    rustc: run('rustc', ['--version'], { env }),
    wasm_bindgen: run(bindgen, ['--version'], { env }),
    profile: 'release (opt-level s, fat LTO, 1 codegen unit, panic abort), default features (JPEG XL in DNG); threads/: + atomics, bulk-memory, mutable-globals, build-std, max memory 1 GiB',
    files,
  };
  writeFileSync(join(crate, 'build.json'), `${JSON.stringify(build, null, 2)}\n`);
  console.log(`built in ${Math.round((Date.now() - t0) / 1000)} s: ${JSON.stringify(files)}`);
}
