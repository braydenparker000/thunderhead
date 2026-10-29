// The result validator (MUSE.md §5 steps 4–5): the JSON Schema subset the order kinds use, no
// library, then hygiene. Every problem is named by its path ("stories[2].blocks[3].kind: one of
// line, column, bar…") so Muse can fix that field; at most 20 are reported. Hygiene strips control
// characters (but newline and tab) and refuses token-shaped strings and javascript: or data: URLs.
import type { Schema, SchemaType } from '../../../../shared/contract/work.ts';

const MAX_PROBLEMS = 20;
/** Token shapes the Worker issues or that leak elsewhere (MUSE.md §5 step 5). */
const TOKENISH = /\b(th1_|thm_|ths_|thc_|thw_|thfp_|sk-)[A-Za-z0-9_-]{8,}|[A-Za-z0-9+/]{120,}={0,2}/;
const BAD_URL = /^\s*(javascript|data|vbscript):/i;
// Control characters but tab, newline and carriage return: matching them is the point.
// biome-ignore lint/suspicious/noControlCharactersInRegex: the hygiene step strips exactly these
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const typeOf = (v: unknown): SchemaType =>
  v === null
    ? 'null'
    : Array.isArray(v)
      ? 'array'
      : typeof v === 'number'
        ? Number.isInteger(v)
          ? 'integer'
          : 'number'
        : (typeof v as SchemaType);

const fits = (v: unknown, t: SchemaType) => {
  const got = typeOf(v);
  return got === t || (t === 'number' && got === 'integer');
};

const httpsOnly = (s: string) => {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && !u.username && !u.password;
  } catch {
    return false;
  }
};

/** Problems with `v` against `s`, each with its path. */
export function check(v: unknown, s: Schema, path = '', out: string[] = []): string[] {
  if (out.length >= MAX_PROBLEMS) return out;
  const at = path || '(result)';
  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t) => fits(v, t))) {
      out.push(`${at}: must be ${types.join(' or ')}`);
      return out;
    }
  }
  if (s.enum && !s.enum.some((e) => e === v)) out.push(`${at}: one of ${s.enum.map(String).join(', ')}`);
  if (typeof v === 'string') {
    if (s.minLength !== undefined && v.length < s.minLength) out.push(`${at}: at least ${s.minLength} characters`);
    if (s.maxLength !== undefined && v.length > s.maxLength) out.push(`${at}: at most ${s.maxLength} characters`);
    if (s.pattern && !new RegExp(s.pattern).test(v)) out.push(`${at}: does not match ${s.pattern}`);
    if (s.format === 'uri' && !httpsOnly(v)) out.push(`${at}: an https URL`);
  }
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) out.push(`${at}: at least ${s.minimum}`);
    if (s.maximum !== undefined && v > s.maximum) out.push(`${at}: at most ${s.maximum}`);
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) out.push(`${at}: at least ${s.minItems} items`);
    if (s.maxItems !== undefined && v.length > s.maxItems) out.push(`${at}: at most ${s.maxItems} items`);
    if (s.items) for (const [i, x] of v.entries()) check(x, s.items, `${path}[${i}]`, out);
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    for (const r of s.required ?? []) if (o[r] === undefined) out.push(`${path ? `${path}.` : ''}${r}: required`);
    for (const [k, x] of Object.entries(o)) {
      const p = path ? `${path}.${k}` : k;
      const sub = s.properties?.[k];
      if (sub) check(x, sub, p, out);
      else if (s.additionalProperties === false) out.push(`${p}: not a field here`);
    }
  }
  return out.slice(0, MAX_PROBLEMS);
}

/** Control characters out of every string (newline and tab stay), in place. */
export function strip(v: unknown): unknown {
  if (typeof v === 'string') return v.replace(CONTROL, '');
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, strip(x)]));
  return v;
}

/** Hygiene problems: a token-shaped string or a script link anywhere. */
export function hygiene(v: unknown, path = '', out: string[] = []): string[] {
  if (out.length >= MAX_PROBLEMS) return out;
  if (typeof v === 'string') {
    if (TOKENISH.test(v)) out.push(`${path || '(result)'}: looks like a token or key; leave it out`);
    if (BAD_URL.test(v)) out.push(`${path || '(result)'}: javascript: and data: links are refused`);
  } else if (Array.isArray(v)) {
    for (const [i, x] of v.entries()) hygiene(x, `${path}[${i}]`, out);
  } else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) hygiene(x, path ? `${path}.${k}` : k, out);
  return out;
}

/** Keywords a schema may use; anything else is refused when an order is made (MUSE.md §5). */
const KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'pattern',
  'format',
]);
export function schemaProblems(s: Schema, path = 'schema'): string[] {
  const out: string[] = [];
  for (const k of Object.keys(s)) if (!KEYWORDS.has(k)) out.push(`${path}.${k}: not a supported keyword`);
  if (s.pattern && (s.pattern.length > 200 || /\\[1-9]/.test(s.pattern)))
    out.push(`${path}.pattern: at most 200 characters, no backreferences`);
  for (const [k, x] of Object.entries(s.properties ?? {})) out.push(...schemaProblems(x, `${path}.properties.${k}`));
  if (s.items) out.push(...schemaProblems(s.items, `${path}.items`));
  return out;
}

/** The whole check of a result: problems (empty when valid) and the cleaned value. */
export function validate(result: unknown, schema: Schema): { problems: string[]; value: unknown } {
  if (!result || typeof result !== 'object' || Array.isArray(result))
    return { problems: ['(result): must be a JSON object'], value: null };
  const value = strip(result);
  const problems = check(value, schema);
  return { problems: problems.length ? problems : hygiene(value), value };
}
