// Types for scripts/schema-version.mjs, imported by the backend's schema test.
export function latestOf(texts: string[]): number;
export function files(cls: 'core' | 'auth'): string[];
export function ready(body: unknown, want: { core: number; auth: number }): string | null;
