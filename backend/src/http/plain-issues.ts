// Every validation issue in plain words with its number (owner, 2026-11-22: no "Invalid input"
// reaches the mind). zod/mini loads no locale, so a check without its own message said only
// "Invalid input"; this names the rule ("at most 200 characters; yours has 212"). It reports
// lengths and types only, never the value sent, so passwords and codes are never echoed back.
// A check's own message still wins over this one.
import * as z from 'zod/mini';

type Raw = {
  code?: string;
  origin?: string;
  maximum?: number | bigint;
  minimum?: number | bigint;
  inclusive?: boolean;
  expected?: string;
  input?: unknown;
  keys?: string[];
  values?: unknown[];
  format?: string;
  pattern?: RegExp | string;
  divisor?: number;
};

const kindOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'a list' : typeof v);
const size = (v: unknown) => (typeof v === 'string' || Array.isArray(v) ? v.length : undefined);
const unit = (origin?: string) =>
  origin === 'string' ? ' characters' : origin === 'array' || origin === 'set' ? ' items' : '';

/** One issue as a plain rule. */
export function plainIssue(iss: Raw): string {
  const n = size(iss.input);
  const has = n === undefined ? '' : `; yours has ${n}`;
  switch (iss.code) {
    case 'too_big':
      return `at most ${iss.inclusive === false ? `under ${iss.maximum}` : iss.maximum}${unit(iss.origin)}${has}`;
    case 'too_small':
      return `at least ${iss.inclusive === false ? `over ${iss.minimum}` : iss.minimum}${unit(iss.origin)}${has}`;
    case 'invalid_type':
      return iss.input === undefined ? `required: ${iss.expected}` : `${iss.expected}; yours is ${kindOf(iss.input)}`;
    case 'unrecognized_keys':
      return `not a known field: ${(iss.keys ?? []).join(', ')}`;
    case 'invalid_value':
      return `one of ${(iss.values ?? []).map((v) => JSON.stringify(v)).join(', ')}`;
    case 'invalid_format':
      return iss.format === 'regex' ? `the form ${String(iss.pattern)}` : `a ${iss.format}`;
    case 'not_multiple_of':
      return `a multiple of ${iss.divisor}`;
    case 'invalid_union':
      return 'matches none of the allowed shapes';
    default:
      return 'does not match its rule';
  }
}

z.config({ customError: (iss) => plainIssue(iss as Raw) });
