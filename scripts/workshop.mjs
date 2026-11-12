#!/usr/bin/env node
// The workshop's files, read from a session the owner gave the Cloudflare account to (API.md
// §11.27): what the owner sent from Settings › Files for the workshop, listed, or fetched and
// joined into one file again. It only reads: a file is sent and removed on the owner's phone.
//
//   node scripts/workshop.mjs list
//   node scripts/workshop.mjs get <name or id> <folder>
//
// The pieces are objects `workshop/<id>/<piece>` in the private bucket, each carrying the file's
// name and size. Each piece is checked against the bucket's own MD5 of it and the joined file
// against its size, so what lands is what the phone sent. Calls go through curl, which follows the
// session's proxy, and the proxy puts the credential in: no token is ever given to this script or
// kept in a session (AGENTS.md). The account is CLOUDFLARE_ACCOUNT_ID when set, else the one account
// the credential sees.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://api.cloudflare.com/client/v4';
const BUCKET = 'thunderhead-private';
const PREFIX = 'workshop/';
const AUTH = 'Authorization: Bearer from-the-session';

/** @param {string[]} args @returns {Buffer} */
const curl = (args) => execFileSync('curl', ['-sSf', '--retry', '4', '--retry-delay', '3', '--max-time', '600', '-H', AUTH, ...args], { maxBuffer: 64 * 1024 * 1024 });
/** @param {string} path */
const json = (path) => JSON.parse(curl([`${API}${path}`]).toString('utf8'));

function account() {
  if (process.env.CLOUDFLARE_ACCOUNT_ID) return process.env.CLOUDFLARE_ACCOUNT_ID;
  const all = json('/accounts').result ?? [];
  if (all.length !== 1) throw new Error(`the credential sees ${all.length} accounts: set CLOUDFLARE_ACCOUNT_ID`);
  return all[0].id;
}

/** A size in words: 38.2 MB. @param {number} bytes */
const sizeOf = (bytes) => (bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** Every file: its pieces in order. @param {string} acct */
export function files(acct) {
  /** @type {Map<string, { id: string, name: string, bytes: number, at: string, pieces: { key: string, n: number, size: number, etag: string }[] }>} */
  const out = new Map();
  let cursor = '';
  do {
    const page = json(`/accounts/${acct}/r2/buckets/${BUCKET}/objects?prefix=${encodeURIComponent(PREFIX)}&per_page=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    for (const o of page.result ?? []) {
      const [id, n] = o.key.slice(PREFIX.length).split('/');
      const bytes = Number(o.custom_metadata?.bytes);
      if (!id || !/^\d{4}$/.test(n ?? '') || !Number.isInteger(bytes)) continue;
      const f = out.get(id) ?? { id, name: decodeURIComponent(o.custom_metadata?.name ?? id), bytes, at: o.last_modified, pieces: [] };
      f.pieces.push({ key: o.key, n: Number(n), size: o.size, etag: String(o.etag ?? '').replace(/^W\/|"/g, '') });
      if (o.last_modified < f.at) f.at = o.last_modified;
      out.set(id, f);
    }
    cursor = page.result_info?.is_truncated ? (page.result_info.cursor ?? '') : '';
  } while (cursor);
  for (const f of out.values()) f.pieces.sort((a, b) => a.n - b.n);
  return [...out.values()].sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** True when every piece is in. @param {ReturnType<typeof files>[number]} f */
const whole = (f) => f.pieces.reduce((s, p) => s + p.size, 0) === f.bytes && f.pieces.every((p, i) => p.n === i + 1);

/** Fetches a file's pieces, checks each, and joins them at `<folder>/<name>`.
 * @param {string} acct @param {ReturnType<typeof files>[number]} f @param {string} folder */
export function fetchFile(acct, f, folder) {
  if (!whole(f)) throw new Error(`${f.name} is not all there yet (${f.pieces.length} pieces)`);
  mkdirSync(folder, { recursive: true });
  // The name came from a phone: nothing of a path is kept.
  const to = join(folder, f.name.replace(/[/\\]/g, '_').replace(/^\.+/, '') || f.id);
  const part = `${to}.part`;
  const out = openSync(to, 'w');
  try {
    for (const p of f.pieces) {
      curl(['-o', part, `${API}/accounts/${acct}/r2/buckets/${BUCKET}/objects/${p.key.split('/').map(encodeURIComponent).join('/')}`]);
      const bytes = readFileSync(part);
      if (bytes.length !== p.size || createHash('md5').update(bytes).digest('hex') !== p.etag) throw new Error(`piece ${p.n} of ${f.name} did not arrive whole`);
      writeSync(out, bytes);
    }
  } finally {
    closeSync(out);
    rmSync(part, { force: true });
  }
  return to;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [verb, what, folder] = process.argv.slice(2);
  let acct = '', all = /** @type {ReturnType<typeof files>} */ ([]);
  try {
    acct = account();
    all = files(acct);
  } catch (e) {
    console.error(`The storage did not answer: ${String(/** @type {Error} */ (e).message).split('\n').at(-2) ?? e}`);
    process.exit(1);
  }
  if (verb === 'list') {
    for (const f of all) console.log(`${f.id}  ${sizeOf(f.bytes).padStart(9)}  ${f.at.slice(0, 10)}  ${whole(f) ? '' : '(not all there) '}${f.name}`);
    if (!all.length) console.log('Nothing in the workshop.');
  } else if (verb === 'get' && what && folder) {
    const hit = all.filter((f) => f.id === what || f.name === what);
    if (hit.length !== 1) throw new Error(hit.length ? `${hit.length} files are named ${what}: give the id` : `no file ${what}`);
    console.log(fetchFile(acct, hit[0], folder));
  } else {
    console.error('usage: node scripts/workshop.mjs list | get <name or id> <folder>');
    process.exit(2);
  }
}
