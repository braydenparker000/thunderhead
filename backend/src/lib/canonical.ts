// Canonical JSON (API.md §7): sorted keys and no whitespace, so the same body or spec always hashes
// the same. Used for idempotent PUTs (http/caller.ts) and proposal spec hashes.

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    );
  return v;
}

export function canonicalJson(v: unknown): string {
  return JSON.stringify(canonical(v));
}
