// Rules checked on the source text (bundled in by Vite, since tests run inside workerd without
// the host file system): TESTING.md §4 `no-timers-in-do`, `env-inventory`, `no-secret-vars`,
// expand-only migrations, zod/mini only, files ≤ 300 lines, no location in the public config.
import { describe, expect, it } from 'vitest';
import { AUTH_MIGRATIONS } from '../../src/objects/auth.migrations';
import { CORE_MIGRATIONS } from '../../src/objects/core.migrations';

const raw = (files: Record<string, unknown>) => files as Record<string, string>;
const objectCode = raw(
  import.meta.glob(
    ['../../src/objects/**/*.ts', '../../src/areas/*/{store,store-keys,flows,common,account,agents,reset}.ts'],
    {
      query: '?raw',
      import: 'default',
      eager: true,
    },
  ),
);
const src = raw(import.meta.glob('../../src/**/*.ts', { query: '?raw', import: 'default', eager: true }));
const allSource = {
  ...src,
  ...raw(
    import.meta.glob(['../**/*.ts', '../../../shared/**/*.ts'], { query: '?raw', import: 'default', eager: true }),
  ),
};
const wrangler = Object.values(
  raw(import.meta.glob('../../wrangler.jsonc', { query: '?raw', import: 'default', eager: true })),
)[0];

const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
// wrangler.jsonc has whole-line comments only, so dropping them leaves plain JSON.
const config = JSON.parse(wrangler.replace(/^\s*\/\/.*$/gm, '')) as { vars: Record<string, string>; secrets: unknown };

/** Every secret name (SECURITY.md §11, P1) and var (OPERATIONS.md §2) the Worker reads. */
const SECRETS = ['AUTH_PEPPER', 'IP_HASH_KEY', 'AUTH_SETUP_FP', 'AUTH_RESET_FP'];
const VARS = ['SITE_ORIGINS', 'OWNER_TZ', 'AUTH_HIBP'];
const BINDINGS = ['VERSION', 'CORE', 'AUTH'];

describe('source rules', () => {
  it('found the files it checks', () => {
    expect(Object.keys(objectCode).length).toBeGreaterThanOrEqual(9);
    expect(wrangler).toContain('thunderhead-api');
  });

  it('no-timers-in-do: no setTimeout or setInterval in code that runs inside Durable Objects', () => {
    for (const [file, code] of Object.entries(objectCode))
      expect(stripComments(code), file).not.toMatch(/\b(setTimeout|setInterval)\s*\(/);
  });

  it('migrations are expand-only, numbered 1…n, never DROP, RENAME, DELETE or UPDATE', () => {
    for (const list of [AUTH_MIGRATIONS, CORE_MIGRATIONS]) {
      expect(list.map((m) => m.version)).toEqual(list.map((_, i) => i + 1));
      for (const m of list) {
        expect(m.kind).toBe('expand');
        for (const sql of m.sql) expect(sql, `migration ${m.version}`).not.toMatch(/\b(DROP|RENAME|DELETE|UPDATE)\b/i);
      }
    }
  });

  it('validation uses zod/mini only (decisions 2026-10-28)', () => {
    for (const [file, code] of Object.entries(src)) expect(code, file).not.toMatch(/from 'zod'/);
  });

  it('files stay at or under 300 lines', () => {
    for (const [file, code] of Object.entries(allSource))
      expect(code.split('\n').length, file).toBeLessThanOrEqual(300);
  });

  it('no-secret-vars: vars hold no secret-looking names, real origins, account ids or locations', () => {
    expect(Object.keys(config.vars).sort()).toEqual([...VARS].sort());
    for (const name of Object.keys(config.vars)) expect(name).not.toMatch(/KEY|SECRET|TOKEN|PEPPER|PASSWORD/);
    expect(config.vars.SITE_ORIGINS).toBe('https://thunderhead.zNN.web.core.windows.net');
    expect(config.vars.OWNER_TZ).toBe('UTC');
    expect(wrangler).not.toMatch(/account_id|[0-9a-f]{32}/);
    for (const code of Object.values(src)) expect(code).not.toMatch(/locationHint/);
  });

  it('secrets.required lists exactly the P1 secrets', () => {
    expect(config.secrets).toEqual({ required: SECRETS });
  });

  it('env-inventory: every env binding the code reads is declared', () => {
    const declared = new Set([...SECRETS, ...VARS, ...BINDINGS]);
    for (const name of BINDINGS) expect(wrangler).toContain(name);
    for (const [file, code] of Object.entries(src))
      for (const [, name] of code.matchAll(/\benv\.([A-Z][A-Z0-9_]+)/g))
        expect(declared, `${file}: env.${name}`).toContain(name);
  });
});
