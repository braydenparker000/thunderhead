#!/usr/bin/env node
// Copies Astra's vendored libraries into frontend/astra/vendor/ from pinned npm packages, and checks
// them. The pins and a sha256 of every file written live in frontend/astra/vendor/vendor.json.
//
//   node scripts/astra/vendor.mjs          fetch the pinned packages (npm pack), write the files, record their hashes
//   node scripts/astra/vendor.mjs --check  verify every vendored file against vendor.json (no network)
//
// To move a library on, change its pin in vendor.json, run the script, try the result, commit both.
// Mediabunny is copied as published (its decoders import ./mediabunny.js instead of the bare name).
// hls.js and dash.js are copied as published (their minified UMD builds and licences), and their files must
// match the integrity hashes pinned beside each pin, which engine/adaptive.js also gives the browser.
// JASSUB ships ES modules with bare imports and the site has no build step, so its main module and its
// worker are bundled here with esbuild (a vendoring-time tool, not a site dependency) into
// self-contained modules; its wasm glue, the two .wasm builds and its default font are copied as they are.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const VENDOR = join(ROOT, 'frontend/astra/vendor');
const MANIFEST = join(VENDOR, 'vendor.json');
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
// The adaptive-stream players: the build Astra loads and the licence files that go with it.
const ADAPTIVE = {
  'hls.js': { from: 'dist/hls.min.js', to: 'hls/hls.min.js', licences: [['LICENSE', 'hls/LICENSE.txt']] },
  dashjs: { from: 'dist/modern/umd/dash.all.min.js', to: 'dash/dash.all.min.js', licences: [['LICENSE.md', 'dash/LICENSE.md'], ['dist/modern/umd/dash.all.min.js.LICENSE.txt', 'dash/dash.all.min.js.LICENSE.txt']] },
};

if (process.argv.includes('--check')) process.exit(check());
build();

/** Every file in the manifest is present with its recorded hash. Returns the exit code. */
function check() {
  let bad = 0;
  for (const [name, want] of Object.entries(manifest.files)) {
    const file = join(VENDOR, name);
    const got = existsSync(file) ? sha256(file) : 'missing';
    if (got !== want) { bad++; console.error(`${name}: ${got === 'missing' ? 'missing' : 'sha256 ' + got + ', expected ' + want}`); }
  }
  console.log(bad ? `${bad} vendored file(s) differ from vendor.json` : `${Object.keys(manifest.files).length} vendored files match vendor.json`);
  return bad ? 1 : 0;
}

function build() {
  const tmp = mkdtempSync(join(tmpdir(), 'astra-vendor-'));
  try {
    const pkg = fetchPackages(tmp);
    const written = [...mediabunny(pkg), ...adaptive(pkg), ...jassub(pkg, tmp)];
    const files = {};
    for (const name of written) files[name] = sha256(join(VENDOR, name));
    for (const [name, hash] of Object.entries(files)) if (manifest.files[name] !== hash) console.log(`${manifest.files[name] ? 'changed' : 'new'}: ${name}`);
    for (const name of Object.keys(manifest.files)) if (!files[name]) console.log(`no longer written (delete it if unused): ${name}`);
    writeFileSync(MANIFEST, JSON.stringify({ ...manifest, files }, null, 2) + '\n');
    console.log(`wrote ${written.length} files; hashes recorded in frontend/astra/vendor/vendor.json`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** npm pack each pinned package into tmp/node_modules/<name> (a layout esbuild resolves bare imports from). */
function fetchPackages(tmp) {
  const out = {};
  for (const [name, version] of Object.entries(manifest.packages)) {
    const dest = join(tmp, 'node_modules', name);
    mkdirSync(dest, { recursive: true });
    const [{ filename }] = JSON.parse(execFileSync('npm', ['pack', `${name}@${version}`, '--json', '--pack-destination', tmp], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
    execFileSync('tar', ['xzf', join(tmp, filename), '-C', dest, '--strip-components=1']);
    const got = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8')).version;
    if (got !== version) throw new Error(`${name}: npm gave ${got}, pinned ${version}`);
    out[name] = dest;
  }
  return out;
}

function write(name, bytes) { mkdirSync(dirname(join(VENDOR, name)), { recursive: true }); writeFileSync(join(VENDOR, name), bytes); return name; }
function copy(from, name) { mkdirSync(dirname(join(VENDOR, name)), { recursive: true }); copyFileSync(from, join(VENDOR, name)); return name; }

function mediabunny(pkg) {
  const decoder = (id) => {
    const text = readFileSync(join(pkg[`@mediabunny/${id}`], `dist/bundles/mediabunny-${id}.min.mjs`), 'utf8');
    const local = text.replace(/from\s*"mediabunny"/g, 'from"./mediabunny.js"');
    if (local === text || /from\s*["']mediabunny["']/.test(local)) throw new Error(`@mediabunny/${id}: the import of mediabunny was not where expected`);
    return write(`mediabunny-${id}.js`, local);
  };
  return [copy(join(pkg.mediabunny, 'dist/bundles/mediabunny.min.mjs'), 'mediabunny.js'), decoder('ac3'), decoder('dts'), decoder('truehd')];
}

/** hls.js and dash.js for adaptive streams, each checked against the integrity hash pinned in vendor.json. */
function adaptive(pkg) {
  const files = [];
  for (const [name, { from, to, licences }] of Object.entries(ADAPTIVE)) {
    const file = join(pkg[name], from);
    const got = 'sha384-' + createHash('sha384').update(readFileSync(file)).digest('base64');
    if (got !== manifest.integrity[name]) throw new Error(`${name}: ${from} is ${got}, pinned ${manifest.integrity[name]}`);
    files.push(copy(file, to), ...licences.map(([source, dest]) => copy(join(pkg[name], source), dest)));
  }
  return files;
}

function jassub(pkg, tmp) {
  const dist = join(pkg.jassub, 'dist');
  // The worker's Google Fonts lookup (lfa-ponyfill, with a 48 kB font list) is never used: Astra turns
  // font queries off, and the page must reach no other origin. A stub takes its place.
  const stub = join(tmp, 'no-remote-fonts.js');
  writeFileSync(stub, '// Astra: remote font lookup removed at vendoring time (queryFonts is off).\nexport async function queryRemoteFonts () { return [] }\n');
  const esbuild = esbuildCommand();
  const bundle = (entry, name, extra = []) => {
    execFileSync(esbuild[0], [...esbuild.slice(1), join(dist, entry), '--bundle', '--format=esm', '--platform=browser', '--legal-comments=inline', '--charset=utf8', `--outfile=${join(VENDOR, name)}`, '--log-level=warning', ...extra], { cwd: tmp, stdio: 'inherit' });
    // A link in a comment is no request, but the site's checks forbid outside addresses in its files:
    // the scheme is dropped from links in line comments, and any other link stops the vendoring.
    const text = readFileSync(join(VENDOR, name), 'utf8').replace(/^(\s*\/\/.*?)https?:\/\//gm, '$1');
    const bare = /(?:^|[;\n])\s*(?:import|export)[^'"\n]*from\s*["'](?![./])([^"']+)["']/m.exec(text);
    if (bare) throw new Error(`${name} still imports ${bare[1]}`);
    const link = /https?:\/\/[^\s"'()<>]+/.exec(text);
    if (link) throw new Error(`${name} names ${link[0]}`);
    writeFileSync(join(VENDOR, name), text);
    return name;
  };
  const files = [
    bundle('jassub.js', 'jassub/jassub.js'),
    bundle('worker/worker.js', 'jassub/worker/worker.js', [`--alias:lfa-ponyfill=${stub}`]),
  ];
  // The wasm glue is already self-contained (Emscripten output with no imports).
  for (const name of ['jassub-worker.js', 'jassub-worker.wasm', 'jassub-worker-modern.js', 'jassub-worker-modern.wasm']) {
    if (name.endsWith('.js') && /^\s*import\s/m.test(readFileSync(join(dist, 'wasm', name), 'utf8'))) throw new Error(`wasm/${name} has imports`);
    files.push(copy(join(dist, 'wasm', name), `jassub/wasm/${name}`));
  }
  files.push(copy(join(dist, 'default.woff2'), 'jassub/default.woff2'), copy(join(pkg.jassub, 'LICENSE'), 'jassub/LICENSE.txt'));
  // JASSUB 2.5 leaves its WebGPU renderer unimported; make sure a later version does not pull it in unseen.
  if (readFileSync(join(VENDOR, 'jassub/worker/worker.js'), 'utf8').includes('WebGPURenderer')) throw new Error('the WebGPU renderer was bundled');
  return files;
}

/** The pinned esbuild: the repository's own copy when it is that version, else npx fetches it. */
function esbuildCommand() {
  const local = join(ROOT, 'node_modules/esbuild/package.json');
  if (existsSync(local) && JSON.parse(readFileSync(local, 'utf8')).version === manifest.esbuild) return [join(ROOT, 'node_modules/.bin/esbuild')];
  return ['npx', '--yes', `esbuild@${manifest.esbuild}`];
}
