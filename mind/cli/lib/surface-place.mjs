// `th surface <app> <slot> …` (home lines and tiles), checked in the forgiving form
// (lib/forgive.mjs) before it is sent: the spaces around --kind, --topic and --why are trimmed and
// said; every fault (the kind, the slot, each payload field, --why with its 8 to 200 characters,
// --topic with its form) comes back in one refusal. The payload's words are never touched.
import {readFileSync} from 'node:fs';
import {toMs} from './io.mjs';
import {CONTRACT} from './contract.mjs';
import {Faults, oneOf, prose, schemaFaults, sent} from './forgive.mjs';

export const WHY = {min: 8, max: 200};
const TOPIC = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** The body of PUT /v1/surfaces/:app/:slot and the request's Faults (repairs in `f.repaired`);
 * throws the one refusal when anything is wrong. */
export function placeBody(app, slot, flags) {
  const f = new Faults();
  const kinds = Object.keys(CONTRACT.surfaces);
  const kind = oneOf(f, '--kind', flags.kind, kinds);
  const k = kind && CONTRACT.surfaces[kind];
  if (k) {
    const pattern = k.slots[app];
    if (!pattern || !new RegExp(pattern).test(slot))
      f.add('slot', `a ${kind} goes in ${Object.entries(k.slots).map(([a, p]) => `${a} ${p}`).join('; ')}`, sent(`${app} ${slot}`));
  }
  let payload;
  if (typeof flags.payload !== 'string' || !flags.payload) f.add('--payload', 'a JSON object (or - for stdin)', 'none sent');
  else {
    const text = flags.payload === '-' ? readFileSync(0, 'utf8') : flags.payload;
    try { payload = JSON.parse(text); } catch { f.add('--payload', 'a JSON object', 'not JSON'); }
  }
  let schema;
  if (k) {
    const versions = Object.keys(k.versions).map(Number);
    schema = flags.schema === undefined ? Math.max(...versions) : Number(flags.schema);
    if (!k.versions[schema]) f.add('--schema', `one of ${versions.join(', ')}`, sent(flags.schema));
    else if (payload !== undefined)
      for (const [path, rule, what] of schemaFaults(payload, k.versions[schema], 'payload')) f.add(path, rule, what);
  }
  const why = prose(f, '--why', flags.why, {min: WHY.min, max: WHY.max});
  let topic;
  if (typeof flags.topic !== 'string' || !flags.topic.trim()) f.add('--topic', 'required: a topic key, 1 to 64 of a-z 0-9 . _ - (starting with a letter or digit)', 'none sent');
  else {
    topic = flags.topic.trim();
    if (topic !== flags.topic) f.fix('--topic: trimmed the spaces around it');
    if (!TOPIC.test(topic)) f.add('--topic', '1 to 64 of a-z 0-9 . _ - (starting with a letter or digit)', sent(flags.topic));
  }
  let expires;
  try { expires = toMs(flags.expires, 'expires'); } catch { f.add('--expires', 'an ISO time', sent(flags.expires)); }
  if (typeof flags.ref === 'string' && flags.ref.length > 200) f.add('--ref', 'at most 200 characters', `yours has ${flags.ref.length}`);
  f.done('th surface <app> <slot> --kind <k> --payload <json|-> --why <8 to 200 characters> --topic <key>');
  return {f, body: {kind, schema, payload, why, topic_key: topic, expires_at: expires}};
}
