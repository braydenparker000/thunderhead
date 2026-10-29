// Writes frontend/ported.json, the record of the as-is port (MIGRATION.md §5.1): for every ported
// file its hash, the old file's hash and the exact edits made to it, each folder's outside hosts
// and page CSPs. tests/ported.test.mjs checks the committed files against it, without the old repo.
// Usage: node scripts/ported.mjs <old repo checkout> <old repo commit>
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** New folder → old folder, the files outside it that the folder loads, and every edit made. */
export const PORT = {
  music: { from: 'frontend/claude-player/', assets: ['assets/error-report.js', 'assets/config.js'] },
  guitar: { from: 'frontend/guitar/', assets: ['assets/config.js', 'assets/error-report.js', 'assets/file-save.js', 'assets/shell.css'] },
  podcasts: { from: 'frontend/podcasts/', assets: ['assets/config.js', 'assets/error-report.js', 'assets/premium.css', 'assets/shell.css'] },
  astra: { from: 'frontend/astra/', assets: ['assets/config.js', 'assets/error-report.js', 'assets/libmedia/'] },
  media: { from: 'frontend/mymedia/', assets: ['assets/config.js', 'assets/error-report.js', 'assets/pip-diagnostics.js', 'assets/ui.js', 'drawercast/drive-api.js'] },
};
/** Files outside the app folders, copied from the same path in the old repo. */
export const SHARED = ['assets/', 'drawercast/drive-api.js'];
/** Each edit as [new text, old text], with its kind. Nothing else may differ from the old bytes. */
export const EDITS = {
  'media/index.html': { adjustments: ['paths'], edits: [['href="/media/mymedia.css', 'href="/mymedia/mymedia.css'], ['src="/media/app.js', 'src="/mymedia/app.js']] },
  // The reporter only reports on its own live site; its site is now this one.
  'assets/error-report.js': { adjustments: ['api-address'], edits: [["const SITE = 'https://thunderhead.z13.web.core.windows.net';", "const SITE = 'https://missionarytube.z13.web.core.windows.net';"]] },
};

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const HOST_URL = /https?:\/\/[^\s"'()<>`\\]+/g;
export function hostsIn(text) {
  const hosts = new Set();
  for (const [url] of text.matchAll(HOST_URL)) {
    const m = /^https?:\/\/([A-Za-z0-9*][A-Za-z0-9.*-]*(?::[0-9*]+)?)/.exec(url);
    if (m) hosts.add(m[1].toLowerCase());
  }
  return hosts;
}
export const cspOf = html => /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? null;
export const TEXT = /\.(html|css|js|json|webmanifest|txt|md)$/;

export async function filesUnder(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    out.push(...(e.isDirectory() ? await filesUnder(p) : [p]));
  }
  return out.sort();
}

/** Reverse the recorded edits: the result must be the old file, byte for byte. */
export function undo(text, edits) {
  let out = text;
  for (const [now, before] of edits) {
    if (!out.includes(now)) throw new Error(`edit not found: ${now}`);
    out = out.split(now).join(before);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [oldRepo, oldCommit] = process.argv.slice(2);
  if (!oldRepo || !/^[0-9a-f]{40}$/.test(oldCommit ?? '')) throw new Error('usage: node scripts/ported.mjs <old repo> <40-hex commit>');
  const site = fileURLToPath(new URL('../frontend/', import.meta.url));
  const old = path => execFileSync('git', ['-C', oldRepo, 'show', `${oldCommit}:${path}`], { maxBuffer: 64 << 20 });
  const record = async (rel, oldPath) => {
    const bytes = await readFile(join(site, rel));
    const before = old(oldPath);
    const e = EDITS[rel] ?? { adjustments: [], edits: [] };
    if (e.edits.length) {
      if (undo(bytes.toString('utf8'), e.edits) !== before.toString('utf8')) throw new Error(`${rel}: differs from the old file beyond its recorded edits`);
    } else if (sha(bytes) !== sha(before)) throw new Error(`${rel}: differs from the old file and has no recorded edits`);
    return { sha256: sha(bytes), old_sha256: sha(before), adjustments: e.adjustments, ...(e.edits.length ? { edits: e.edits } : {}) };
  };
  const folders = {};
  for (const [name, { from, assets }] of Object.entries(PORT)) {
    const files = {}, hosts = new Set(), csp = {};
    for (const f of await filesUnder(join(site, name))) {
      const rel = relative(site, f);
      files[rel] = await record(rel, from + rel.slice(name.length + 1));
      if (TEXT.test(rel)) {
        const text = await readFile(f, 'utf8');
        for (const h of hostsIn(text)) hosts.add(h);
        if (rel.endsWith('.html')) csp[rel] = cspOf(text);
      }
    }
    folders[name] = { from, files, assets, hosts: [...hosts].sort(), csp };
  }
  const shared = {}, sharedHosts = new Set();
  for (const s of SHARED) {
    const list = s.endsWith('/') ? await filesUnder(join(site, s)) : [join(site, s)];
    for (const f of list) {
      const rel = relative(site, f);
      shared[rel] = await record(rel, 'frontend/' + rel);
      if (TEXT.test(rel)) for (const h of hostsIn(await readFile(f, 'utf8'))) sharedHosts.add(h);
    }
  }
  const out = { v: 1, old_repo: 'braydenparker000/Missionarytube-', old_repo_commit: oldCommit, folders, shared, shared_hosts: [...sharedHosts].sort() };
  await writeFile(join(site, 'ported.json'), JSON.stringify(out, null, 1) + '\n');
  const n = Object.values(folders).reduce((a, f) => a + Object.keys(f.files).length, 0) + Object.keys(shared).length;
  console.log(`ported.json: ${n} files from ${oldCommit.slice(0, 12)}`);
}
