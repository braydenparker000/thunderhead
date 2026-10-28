// Request validation with zod/mini, once, at the edge. Issues carry the field path and the rule
// only (zod does not include the input value unless asked), so passwords and codes are never
// echoed back. A shape failure is 422 validation; unparseable JSON is 400 bad_request.
import type { Context } from 'hono';
import type * as z from 'zod/mini';
import { ApiError } from './errors';

export async function json<S extends z.ZodMiniType>(c: Context, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError('bad_request');
  }
  return parse(schema, raw);
}

export function parse<S extends z.ZodMiniType>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.'), issue: i.message }));
    throw new ApiError('validation', details);
  }
  return result.data;
}
