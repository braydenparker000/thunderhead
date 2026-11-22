// `th remember`, `th thread` and the checks `th facts` runs on a batch before it is sent, in the
// forgiving form (lib/forgive.mjs): obvious slips are repaired and listed in `repaired`, and every
// fault of the request comes back in one refusal with its rule, its number and what was sent.
import {parseArgs} from './args.mjs';
import {out, toMs} from './io.mjs';
import {CONTRACT} from './contract.mjs';
import {request} from './http.mjs';
import {uuidv7} from './ids.mjs';
import {Faults, clamp, evidence, oneOf, prose, sent} from './forgive.mjs';
import {FACT_KINDS, factResult, ops} from './memory.mjs';

const ML = CONTRACT.memory.limits;
const SOURCES = Object.keys(CONTRACT.memory.sources);
const OPS = ['add', 'confirm', 'supersede', 'pin', 'may_raise', 'forget'];
const seg = value => encodeURIComponent(String(value));

/** A time flag (`--due`, `--valid-from`) as ms, or a fault. */
function when(f, flags, name) {
  try { return toMs(flags[name], name); } catch (e) { f.add(`--${name}`, 'an ISO date or time', sent(flags[name])); return undefined; }
}

export async function remember(argv) {
  const {flags} = parseArgs(argv);
  const f = new Faults();
  const kind = oneOf(f, '--kind', flags.kind, FACT_KINDS);
  const source = oneOf(f, '--source', flags.source, SOURCES, {fallback: 'user'});
  const sensitivity = flags.sensitivity === undefined ? 0 : clamp(f, '--sensitivity', flags.sensitivity, 0, 1, {integer: true});
  const text = prose(f, '--text', flags.text, {max: ML.fact_text});
  const refs = evidence(f, flags.evidence);
  const validFrom = when(f, flags, 'valid-from');
  const subject = typeof flags.subject === 'string' && flags.subject.trim() ? flags.subject.trim() : 'owner';
  if (subject.length > 64) f.add('--subject', 'at most 64 characters', `yours has ${subject.length}`);
  f.done('th remember --kind <k> --text <t> --evidence <ids> [--subject] [--sensitivity 0|1] [--source]');
  const data = await ops([{op: 'add', id: uuidv7(), kind, subject, text, source, evidence: refs, valid_from: validFrom, sensitivity}]);
  out(f.with(factResult(data)));
}

/** Open threads (commitments): add | done | drop | list. */
export async function thread(argv) {
  const {flags, rest} = parseArgs(argv);
  const [sub, ...words] = rest;
  if (sub === 'list') {
    const {data} = await request('GET', '/v1/memory/open-threads', {query: {status: 'open'}});
    return out({items: data.items || []});
  }
  const f = new Faults();
  if (sub === 'add') {
    const text = prose(f, 'text', words.length ? words.join(' ') : undefined, {max: ML.thread_text});
    const owner = oneOf(f, '--owner', flags.owner, ['mind', 'owner'], {fallback: 'mind'});
    const due = when(f, flags, 'due');
    const refs = evidence(f, flags.evidence);
    f.done('th thread add <text> [--owner mind|owner] [--due <date>] --evidence <ids>');
    const id = uuidv7();
    const {data} = await request('PUT', `/v1/memory/open-threads/${seg(id)}`, {body: {text, owner, due_at: due, evidence: refs}});
    return out(f.with({id, provenance: data?.provenance ?? null}));
  }
  if (sub === 'done' || sub === 'drop') {
    const id = words[0];
    if (!id) f.add('id', 'the open thread\'s id (th thread list)', 'none sent');
    const why = sub === 'drop' ? prose(f, '--why', flags.why, {max: 200}) : undefined;
    f.done(`th thread ${sub} <id>${sub === 'drop' ? ' --why <1 to 200 characters>' : ''}`);
    await request('PATCH', `/v1/memory/open-threads/${seg(id)}`, {body: {status: sub === 'done' ? 'done' : 'dropped', why}});
    return out(f.with({id}));
  }
  f.add('subcommand', 'add, done, drop or list', sent(sub));
  f.done('th thread add <text> --evidence <ids> | done <id> | drop <id> --why <t> | list');
}

/** A fact's fields in a batch op (`add`, or a supersede's `new`): trimmed text within the limit,
 * known kind and source, 1 to 20 evidence ids. Returns the op as it will be sent. */
function factFields(f, at, raw, {needKind}) {
  const o = {...raw};
  o.text = prose(f, `${at}.text`, raw.text, {max: ML.fact_text});
  if (needKind || raw.kind !== undefined) o.kind = oneOf(f, `${at}.kind`, raw.kind, FACT_KINDS);
  if (needKind || raw.source !== undefined) o.source = oneOf(f, `${at}.source`, raw.source, SOURCES);
  if (raw.sensitivity !== undefined) o.sensitivity = clamp(f, `${at}.sensitivity`, raw.sensitivity, 0, 1, {integer: true});
  o.evidence = evidence(f, raw.evidence, {field: `${at}.evidence`});
  return o;
}

/** `th facts --batch`: every op checked before the batch is sent; one refusal names every fault.
 * Returns {ops, faults} with the repaired ops. */
export function checkBatch(list) {
  const f = new Faults();
  if (!Array.isArray(list) || !list.length || list.length > ML.ops_per_batch) {
    f.add('--batch', `1 to ${ML.ops_per_batch} ops, as {"ops":[…]} or […]`, Array.isArray(list) ? `yours has ${list.length}` : 'no list of ops');
    f.done();
  }
  const body = list.map((raw, i) => {
    const at = `ops.${i}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { f.add(at, 'an op object', sent(raw)); return raw; }
    if (!OPS.includes(raw.op)) { f.add(`${at}.op`, `one of ${OPS.join(', ')}`, sent(raw.op)); return raw; }
    if (raw.op === 'add') return factFields(f, at, raw, {needKind: true});
    if (raw.op === 'supersede') {
      if (!raw.new || typeof raw.new !== 'object') { f.add(`${at}.new`, 'the new fact: {text, evidence, …}', sent(raw.new)); return raw; }
      return {...raw, new: factFields(f, `${at}.new`, raw.new, {needKind: false})};
    }
    if (raw.op === 'confirm' && raw.evidence !== undefined) return {...raw, evidence: evidence(f, raw.evidence, {field: `${at}.evidence`})};
    return raw;
  });
  f.done('th facts --batch <file.json | -> [--night [--part <k>] [--day <day>]]');
  return {ops: body, faults: f};
}
