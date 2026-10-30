// Conversation and session commands: say, amend, history, file, status, title, note, pending,
// taint, health, errors, ledger, undo (RUNTIME.md §5.3, API.md §11.7–11.9, §11.16).
import {mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {basename, dirname, extname, join} from 'node:path';
import {parseArgs} from './args.mjs';
import {EXIT, ThError, VERSION, exitFor, invalid, jsonFlag, need, out, textArg, toMs} from './io.mjs';
import {CONTRACT, checkRoute, routeOf} from './contract.mjs';
import {request, settings, sleep, stopNotice} from './http.mjs';
import {getState, setState, thDir} from './state.mjs';
import {sha256, uuidv7} from './ids.mjs';

export const KINDS = ['text', 'progress', 'card', 'question', 'error'];
export const STATES = ['working', 'listening', 'stopping', 'limited'];
const MAX_BODY = 16_000;
/** What the Worker takes (shared/contract/files.ts): bytes per file, files per mind message, name length. */
const FILES = CONTRACT.files.limits;
/** Extension → type for uploads; the first extension of a type names a download. */
const TYPES = {png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
  json: 'application/json', html: 'text/html', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4',
  webm: 'audio/webm', mp4: 'video/mp4', mov: 'video/quicktime', zip: 'application/zip'};
const EXT = {};
for (const [ext, type] of Object.entries(TYPES)) EXT[type] ??= ext;
const UUID7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const seg = value => encodeURIComponent(String(value));
const mib = n => `${Math.round(n / 1024 / 1024)} MiB`;

/** The file's own name, cut to the Worker's limit with its extension kept. */
export function fileName(path) {
  const name = basename(path);
  if ([...name].length <= FILES.name) return name;
  const ext = extname(name);
  return [...name.slice(0, name.length - ext.length)].slice(0, FILES.name - [...ext].length).join('') + ext;
}

async function upload(path) {
  let size;
  try { size = statSync(path).size; } catch { throw invalid(`cannot read ${path}`); }
  if (size > FILES.bytes) throw invalid(`${basename(path)} is over ${mib(FILES.bytes)}`);
  if (!size) throw invalid(`${basename(path)} is empty`);
  const bytes = readFileSync(path);
  // The id is made once, so a retry after a lost answer is the same file (the Worker answers 200).
  const {data} = await request('PUT', `/v1/files/${uuidv7()}`, {
    raw: bytes, timeoutMs: 120_000,
    headers: {'Content-Type': TYPES[extname(path).slice(1).toLowerCase()] || 'application/octet-stream',
      'TH-File-Name': encodeURIComponent(fileName(path)), 'TH-Sha256': sha256(bytes)},
  });
  return data.ref;
}

/** A file's bytes from GET /v1/files/:id. `request` reads JSON, so the bytes come through this one
 * call: the same headers (in a session the network secret adds Authorization), the same retries. */
async function fileBytes(path) {
  checkRoute('GET', path);
  const s = settings();
  if (!s.api) throw new ThError(EXIT.unreachable, 'no_api', 'TH_API is not set');
  const headers = {'TH-Client': `th/${VERSION}`};
  if (s.role) headers['TH-Role'] = s.role;
  if (s.session) headers['TH-Session'] = s.session;
  if (process.env.TH_SANDBOX === 'eval' || getState('sandbox') === 'eval') headers['TH-Sandbox'] = 'eval';
  if (s.token) headers.Authorization = `Bearer ${s.token}`;
  let last = new ThError(EXIT.unreachable, 'unreachable', 'no attempt made');
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(s.retryBaseMs * 2 ** (attempt - 1));
    let res;
    try { res = await fetch(s.api + path, {headers, signal: AbortSignal.timeout(120_000)}); } catch (error) {
      last = new ThError(EXIT.unreachable, error?.name === 'TimeoutError' ? 'timeout' : 'unreachable', `GET ${path}: no answer`);
      continue;
    }
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const e = (await res.json().catch(() => null))?.error;
    const code = e?.code || `http_${res.status}`;
    last = new ThError(exitFor(res.status, code), code, e?.message || `HTTP ${res.status}`, e?.request_id || res.headers.get('th-request-id'));
    if (last.exit !== EXIT.unreachable) throw last;
  }
  throw last;
}

/** The Worker's phrase lint (shared/contract/lint.ts, via contract.json): code fences are exempt. */
export function lintText(text) {
  const prose = text.replace(/```[\s\S]*?```/g, ' ').toLowerCase();
  for (const p of CONTRACT.lint.banned_phrases) if (prose.includes(p)) return `banned phrase: "${p}"`;
  if (/\p{Extended_Pictographic}/u.test(prose)) return 'no emoji';
  return null;
}

export async function say(argv) {
  const {flags, rest} = parseArgs(argv, {repeat: ['attach']});
  const [thread, ...words] = rest;
  if (!thread || !words.length) throw invalid('usage: th say today|system [--reply-to <id>] [--kind k] [--meta <json>] [--attach <file>]… <text|->');
  // Messages always go to today's thread; night and reflex post errors to `system`.
  if (thread !== 'today' && thread !== 'system') throw invalid('th say takes today (or system, for --kind error from night and reflex)');
  const kind = flags.kind ?? 'text';
  if (!KINDS.includes(kind)) throw invalid(`--kind must be one of ${KINDS.join(', ')}`);
  const text = textArg(words);
  if (!text.trim()) throw invalid('the message is empty');
  if (text.length > MAX_BODY) throw invalid(`the message is over ${MAX_BODY} characters`);
  const lint = kind === 'text' || kind === 'question' ? lintText(text) : null;
  if (lint) throw invalid(`the phrase lint refuses it (${lint})`);
  if (flags.attach.length > FILES.mind_per_message) throw invalid(`at most ${FILES.mind_per_message} attachments`);
  const meta = jsonFlag(flags.meta, 'meta');
  const attachments = [];
  for (const path of flags.attach) attachments.push(await upload(path));
  // The id is made here, so a retry after a lost response is the same message (idempotent PUT).
  const id = uuidv7();
  const body = {body: text, kind, meta, reply_to: typeof flags['reply-to'] === 'string' ? flags['reply-to'] : undefined,
    attachments: attachments.length ? attachments : undefined, thread_id: thread === 'system' ? 'system' : undefined};
  const res = await request('PUT', `/v1/messages/${seg(id)}`, {body});
  stopNotice(res);
  out({id: res.data?.id || id});
}

export async function amend(argv) {
  const {flags, rest} = parseArgs(argv);
  if (!rest[0]) throw invalid('usage: th amend <message id> [--meta <json>] [--body <text|->]');
  const body = flags.body === undefined ? undefined : textArg([String(flags.body)]);
  const res = await request('PATCH', `/v1/messages/${seg(rest[0])}`, {body: {body, meta: jsonFlag(flags.meta, 'meta')}});
  stopNotice(res);
  out({id: res.data?.id || rest[0]});
}

export async function history(argv) {
  const {flags, rest} = parseArgs(argv);
  if (!rest[0]) throw invalid('usage: th history <thread|today> [--limit 40] [--before <seq>]');
  if (rest[0] === 'today') {
    const {data} = await request('GET', '/v1/threads/today');
    return out({items: data.messages || [], next: null, thread: data.thread?.id ?? null});
  }
  const {data} = await request('GET', `/v1/threads/${seg(rest[0])}/messages`,
    {query: {limit: Number(flags.limit) || 40, before_seq: flags.before}});
  out({items: data.items || [], next: data.next ?? null});
}

/** Downloads an attachment through the Worker (GET /v1/files/:id): its record first (name, type,
 * a memo's words), then its bytes, saved as `$TMPDIR/th/files/<id>.<ext>` unless --out names a path. */
export async function file(argv) {
  const {flags, rest} = parseArgs(argv);
  if (!rest[0]) throw invalid('usage: th file <id|file:id> [--out <path>]');
  const id = rest[0].startsWith('file:') ? rest[0].slice(5) : rest[0];
  if (!UUID7.test(id)) throw invalid('th file takes an attachment id or its file:<id> ref');
  const {data: meta} = await request('GET', `/v1/files/${seg(id)}`, {query: {meta: 1}});
  const bytes = await fileBytes(`/v1/files/${seg(id)}`);
  const path = typeof flags.out === 'string' ? flags.out : join(thDir(), 'files', `${id}.${EXT[meta.type] || 'bin'}`);
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, bytes);
  out({path, type: meta.type, name: meta.name, ...(meta.text ? {text: meta.text} : {})});
}

export async function status(argv) {
  const {flags, rest} = parseArgs(argv);
  const state = rest[0];
  if (!STATES.includes(state)) throw invalid(`usage: th status ${STATES.join('|')} [--thread <id>] [--note <text>] [--error <code>]`);
  const note = typeof flags.note === 'string' ? flags.note : undefined;
  if (note && note.length > 140) throw invalid('--note is over 140 characters');
  const res = await request('POST', '/v1/mind/status', {
    body: {state, thread_id: typeof flags.thread === 'string' ? flags.thread : undefined, note,
      error: typeof flags.error === 'string' ? flags.error : undefined},
  });
  setState('status', {state, at: Date.now()});
  stopNotice(res);
  out({ok: true});
}

export async function title(argv) {
  const {rest} = parseArgs(argv);
  const [thread, ...words] = rest;
  const text = words.join(' ').trim();
  if (!thread || !text) throw invalid('usage: th title <thread> <title>');
  if (text.length > 80) throw invalid('the title is over 80 characters');
  await request('PATCH', `/v1/threads/${seg(thread)}`, {body: {title: text}});
  out({ok: true});
}

export async function note(argv) {
  const {flags} = parseArgs(argv);
  if (flags.session === undefined || flags.session === true) throw invalid('usage: th note --session <text|-> [--open <json>]');
  const body = textArg([String(flags.session)]).trim();
  const words = body.split(/\s+/).filter(Boolean).length;
  if (!words) throw invalid('the session note is empty');
  if (words > 120) throw invalid(`the session note has ${words} words (max 120)`);
  const open = jsonFlag(flags.open, 'open') ?? [];
  if (!Array.isArray(open) || open.length > 10) throw invalid('--open must be a JSON array of at most 10 {text, ref?}');
  const id = uuidv7();
  await request('POST', '/v1/mind/notes', {
    body: {id, thread_id: typeof flags.thread === 'string' ? flags.thread : undefined, body,
      open_items: open.map(item => (typeof item === 'string' ? {text: item} : item))},
  });
  setState('note_at', Date.now());
  out({id});
}

export async function pending() {
  const {data} = await request('GET', '/v1/mind/pending');
  out(data);
}

export async function taint(argv) {
  const {flags} = parseArgs(argv);
  const source = need(flags, 'source');
  const ref = typeof flags.ref === 'string' ? flags.ref : '';
  // The URL itself is never sent (API.md §11.8), only its kind.
  const refKind = /^https?:\/\//.test(ref) ? 'url' : /comment/i.test(source + ref) ? 'comment' : ref ? 'file' : undefined;
  const {data} = await request('POST', '/v1/mind/taint', {body: {source, ref_kind: refKind}});
  setState('tainted', true);
  setState('taint_pending', null); // the hooks' mark (RUNTIME.md §6.5): sent now
  out({tainted: data?.tainted ?? true});
}

export async function health(argv) {
  const {flags} = parseArgs(argv, {bool: ['deep']});
  const {data} = await request('GET', flags.deep ? '/v1/ops/health/deep' : '/v1/health');
  out(data);
}

export async function errors(argv) {
  const {flags} = parseArgs(argv);
  const since = Date.now() - (Number(flags.hours) || 24) * 3_600_000;
  const {data} = await request('GET', '/v1/ops/errors', {query: {status: 'open', since, limit: 200}});
  out({items: data.items || []});
}

export async function ledger(argv) {
  const {flags} = parseArgs(argv);
  const {data} = await request('GET', '/v1/ledger', {query: {since: toMs(flags.since, 'since'),
    kind: typeof flags.kind === 'string' ? flags.kind : undefined, limit: Number(flags.limit) || 50}});
  out({items: data.items || [], next: data.next ?? null});
}

/** `th get <path> [key=value …]`: any GET route the contract lists as built (EXTENDING.md rule 8). */
export async function get(argv) {
  const {rest} = parseArgs(argv);
  const [path, ...pairs] = rest;
  if (!path || !path.startsWith('/v1/')) throw invalid('usage: th get /v1/<path> [key=value …] (th help lists the routes)');
  if (!routeOf('GET', path)) throw invalid(`GET ${path} is not in the contract (th help lists the routes)`);
  const query = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq < 1) throw invalid(`${pair}: query parameters are key=value`);
    query[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  const {data} = await request('GET', path, {query});
  out(data);
}

export async function undo(argv) {
  const {rest} = parseArgs(argv);
  if (!rest[0]) throw invalid('usage: th undo <ledger id>');
  const {data} = await request('POST', `/v1/ledger/${seg(rest[0])}/undo`, {body: {}});
  out({ledger_id: data.undo_ledger_id ?? null, status: data.status ?? null});
}
