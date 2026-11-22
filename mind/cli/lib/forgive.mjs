// Forgiving commands (owner, 2026-11-22): a command repairs what has one obvious meaning and says so
// (`repaired: […]`), and refuses once, completely: every fault of the whole request in one answer,
// each as the field, the rule in plain words with its number, and what was sent ("text: at most 280
// characters; yours has 312"). Prose the owner reads or that becomes memory is never cut or
// reworded: only its surrounding whitespace is trimmed. The checks run here, from contract.json,
// so the common faults cost no round trip to the Worker.
import {ThError, EXIT} from './io.mjs';
import {CONTRACT} from './contract.mjs';

const ML = CONTRACT.memory.limits;

/** A short, safe picture of what was sent: lengths for text, the value itself only when short. */
export function sent(value) {
  if (value === undefined) return 'none sent';
  if (typeof value === 'string') return value.length > 24 ? `yours has ${value.length} characters` : `you sent ${JSON.stringify(value)}`;
  const json = JSON.stringify(value);
  return json && json.length <= 24 ? `you sent ${json}` : `you sent a ${Array.isArray(value) ? 'list' : typeof value}`;
}

/** One request's faults and repairs. `add` names a fault; `fix` names a repair; `done` throws the
 * one refusal when there is any fault. */
export class Faults {
  constructor() { this.faults = []; this.repaired = []; }
  add(field, rule, what) { this.faults.push({field, rule, sent: what}); }
  fix(entry) { this.repaired.push(entry); }
  get any() { return this.faults.length > 0; }
  done(usage) {
    if (!this.faults.length) return;
    const lines = this.faults.map(f => `${f.field}: ${f.rule}${f.sent ? `; ${f.sent}` : ''}`);
    const message = `${this.faults.length === 1 ? '1 fault' : `${this.faults.length} faults`}: ${lines.join(' · ')}${usage ? ` (${usage})` : ''}`;
    throw new ThError(EXIT.validation, 'validation', message, null,
      this.faults.map(f => ({path: f.field, issue: f.rule, ...(f.sent ? {sent: f.sent} : {})})));
  }
  /** The answer with what was repaired, when anything was. */
  with(answer) { return this.repaired.length ? {...answer, repaired: this.repaired} : answer; }
}

/** Text the owner reads or that becomes memory: trimmed (said once), never cut. */
export function prose(f, field, value, {min = 1, max, required = true} = {}) {
  if (value === undefined || value === true) {
    if (required) f.add(field, max ? `required, ${min} to ${max} characters` : 'required', 'none sent');
    return undefined;
  }
  const raw = String(value);
  const text = raw.trim();
  if (text !== raw && text) f.fix(`${field}: trimmed the spaces around it`);
  if (text.length < min) f.add(field, min > 1 ? `at least ${min} characters` : 'required, not empty', `yours has ${text.length}`);
  else if (max && text.length > max) f.add(field, `at most ${max} characters`, `yours has ${text.length}`);
  return text;
}

/** One of a fixed list (trimmed). */
export function oneOf(f, field, value, allowed, {fallback} = {}) {
  if (value === undefined && fallback !== undefined) return fallback;
  const v = typeof value === 'string' ? value.trim() : value;
  if (typeof v === 'string' && v !== value && allowed.includes(v)) f.fix(`${field}: trimmed the spaces around it`);
  if (!allowed.includes(v)) { f.add(field, `one of ${allowed.join(', ')}`, sent(value)); return undefined; }
  return v;
}

/** A number clamped into [lo, hi] (said once); not a number is a fault. */
export function clamp(f, field, value, lo, hi, {integer = false} = {}) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) { f.add(field, `a number from ${lo} to ${hi}`, sent(value)); return undefined; }
  let v = Math.min(hi, Math.max(lo, n));
  if (integer) v = Math.round(v);
  if (v !== n) f.fix(`${field}: ${n} → ${v} (${lo} to ${hi})`);
  return v;
}

/** Evidence ids: a bare id is a message (`msg:<id>`); repeats dropped; 1 to 20, each ≤ 240 characters. */
export function evidence(f, value, {field = '--evidence', required = true} = {}) {
  const given = Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(',') : [];
  const refs = given.map(r => r.trim()).filter(Boolean).map(r => (/^[a-z][a-z0-9]{1,15}:/.test(r) ? r : `msg:${r}`));
  const unique = [...new Set(refs)];
  if (unique.length < refs.length) f.fix(`${field}: dropped ${refs.length - unique.length} repeated id(s)`);
  if (required && !unique.length) f.add(field, `1 to ${ML.evidence_max} ids (a message id, or kind:id)`, 'none sent');
  if (unique.length > ML.evidence_max) f.add(field, `at most ${ML.evidence_max} ids`, `yours has ${unique.length}`);
  const long = unique.find(r => r.length > 240);
  if (long) f.add(field, 'each id at most 240 characters', `one has ${long.length}`);
  return unique;
}

/** Every problem of a value against a contract JSON Schema (the subset scripts/contract.mjs emits),
 * not only the first: `[path, rule, sent]` each. */
export function schemaFaults(value, schema, path = '', faults = []) {
  const at = path || '(value)';
  if (!schema || typeof schema !== 'object') return faults;
  if (Array.isArray(schema.anyOf)) {
    if (!schema.anyOf.some(s => !schemaFaults(value, s, path).length)) faults.push([at, 'matches none of the allowed shapes', sent(value)]);
    return faults;
  }
  if ('const' in schema && value !== schema.const) { faults.push([at, `must be ${JSON.stringify(schema.const)}`, sent(value)]); return faults; }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) { faults.push([at, `one of ${schema.enum.map(e => JSON.stringify(e)).join(', ')}`, sent(value)]); return faults; }
  const types = schema.type ? [].concat(schema.type) : null;
  if (types && !types.some(t => typeOk(value, t))) { faults.push([at, `must be ${types.join(' or ')}`, sent(value)]); return faults; }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) faults.push([at, `at least ${schema.minLength} characters`, `yours has ${value.length}`]);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) faults.push([at, `at most ${schema.maxLength} characters`, `yours has ${value.length}`]);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) faults.push([at, `the form ${schema.pattern}`, sent(value)]);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) faults.push([at, `at least ${schema.minimum}`, sent(value)]);
    if (schema.maximum !== undefined && value > schema.maximum) faults.push([at, `at most ${schema.maximum}`, sent(value)]);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) faults.push([at, `at least ${schema.minItems} items`, `yours has ${value.length}`]);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) faults.push([at, `at most ${schema.maxItems} items`, `yours has ${value.length}`]);
    if (schema.items) value.forEach((v, i) => schemaFaults(v, schema.items, `${path}[${i}]`, faults));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const props = schema.properties || {};
    const pre = path ? `${path}.` : '';
    for (const key of schema.required || []) if (!(key in value)) faults.push([`${pre}${key}`, 'required', 'none sent']);
    for (const [key, v] of Object.entries(value)) {
      if (key in props) schemaFaults(v, props[key], `${pre}${key}`, faults);
      else if (schema.additionalProperties === false) faults.push([`${pre}${key}`, 'not a known field', '']);
    }
  }
  return faults;
}

function typeOk(value, t) {
  return t === 'null' ? value === null
    : t === 'array' ? Array.isArray(value)
      : t === 'integer' ? Number.isInteger(value)
        : t === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
          : typeof value === t;
}
