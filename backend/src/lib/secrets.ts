// Worker secrets that are listed in wrangler.jsonc `secrets.required` but not configured yet hold
// the literal `none` (decisions 2026-10-28). Unset, empty and `none` all mean "absent".
export function present(value: string | undefined | null): string | null {
  const v = value?.trim();
  return v && v !== 'none' ? v : null;
}
