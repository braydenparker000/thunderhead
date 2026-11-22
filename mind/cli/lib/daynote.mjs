// `th daynote <day> --summary "<≤ 150 words>" [--decisions '<json>' | --decision "<text>" …]
// --importance <1-10> [--voice "<≤ 200>"] [--title "<≤ 80>"]` (night step 2, MEMORY.md §3.1): the
// day note, and in the same call the night's line on the day in its own voice (PUT …/voice, as
// `th note --day-voice`) and the title of the day's thread (PATCH /v1/threads/:id, as `th title`).
// `--decisions` takes a JSON list of strings or of objects (each object's text, decision, what or
// summary, else its values joined); `--decision` may repeat. The Worker keeps strings only.
//
//   → {"version","provenance"[,"kept_owner_edit"][,"voice"][,"title"]}
import {invalid, jsonFlag, need, out} from './io.mjs';
import {parseArgs} from './args.mjs';
import {request} from './http.mjs';
import {lintText} from './lint.mjs';

const USAGE = 'usage: th daynote <YYYY-MM-DD> --summary "<≤ 150 words>" [--decisions \'["…"]\' | --decision "<text>" …] --importance <1-10> [--voice "<≤ 200>"] [--title "<≤ 80>"]';
const VOICE_MAX = 200;
const TITLE_MAX = 80;
const DECISIONS_MAX = 10;

/** One decision as the Worker keeps it: a string. */
function decisionText(d, i) {
  if (typeof d === 'string') return d.trim();
  if (d && typeof d === 'object') {
    const named = [d.text, d.decision, d.what, d.summary].find(v => typeof v === 'string' && v.trim());
    return (named ?? Object.values(d).filter(v => typeof v === 'string' || typeof v === 'number').join(' — ')).trim();
  }
  throw invalid(`decision ${i + 1}: a string or an object with its text`);
}

/** The decisions from `--decisions` (a JSON list, or one plain sentence) and every `--decision`. */
export function decisionsOf(flags) {
  let list = [];
  if (flags.decisions !== undefined && flags.decisions !== true) {
    const raw = String(flags.decisions).trim();
    list = raw.startsWith('[') || raw.startsWith('{') ? jsonFlag(raw, 'decisions') : [raw];
    if (!Array.isArray(list)) list = [list];
  }
  const more = [flags.decision ?? []].flat().filter(v => v !== true);
  const all = [...list, ...more].map(decisionText).filter(Boolean);
  if (all.length > DECISIONS_MAX) throw invalid(`at most ${DECISIONS_MAX} decisions`);
  return all;
}

/** A one-line text within `max`, through the phrase lint (the voice line), or the reason not. */
function line(flag, value, max) {
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) throw invalid(`--${flag} is empty. ${USAGE}`);
  if (text.length > max) throw invalid(`--${flag} has ${text.length} characters (max ${max})`);
  return text;
}

export async function daynote(argv) {
  const {flags, rest} = parseArgs(argv, {repeat: ['decision']});
  const d = rest[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d ?? ''))) throw invalid(`a day must be YYYY-MM-DD. ${USAGE}`);
  const importance = Number(flags.importance);
  if (!(importance >= 1 && importance <= 10)) throw invalid('--importance must be 1-10');
  const decisions = decisionsOf(flags);
  const voice = flags.voice === undefined ? null : line('voice', flags.voice, VOICE_MAX);
  if (voice && lintText(voice)) throw invalid(`--voice: the phrase lint refuses it (${lintText(voice)})`);
  const title = flags.title === undefined ? null : line('title', flags.title, TITLE_MAX);
  const {data} = await request('PUT', `/v1/memory/day-notes/${d}`, {body: {summary: need(flags, 'summary'), decisions, importance}});
  // The owner edited this day: their note stands and this one was not written.
  const res = {version: data.version ?? null, ...(data.kept_owner_edit ? {kept_owner_edit: true} : {}), provenance: data.provenance ?? null};
  if (voice) res.voice = (await request('PUT', `/v1/memory/day-notes/${d}/voice`, {body: {line: voice}})).data?.voice ?? voice;
  if (title) res.title = await titleDay(d, title);
  out(res);
}

/** The closed day's thread gets the title (as `th title`); a refusal is reported, not fatal. */
async function titleDay(day, title) {
  const page = (await request('GET', `/v1/mind/day/${day}`, {query: {part: 'messages', limit: 1}})).data;
  const thread = page?.items?.[0]?.thread_id;
  if (!thread) return {set: false, why: 'the day has no thread'};
  try {
    await request('PATCH', `/v1/threads/${encodeURIComponent(thread)}`, {body: {title}});
    return {set: true, thread};
  } catch (e) {
    return {set: false, thread, why: e?.message ?? 'refused'};
  }
}
