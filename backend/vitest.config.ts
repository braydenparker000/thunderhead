// Tests run inside workerd (the real Workers runtime) with real SQLite Durable Objects, built
// from wrangler.jsonc, so bindings, migrations and compatibility settings match production.
import { createHash } from 'node:crypto';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { SETUP_CODE } from './tests/fixtures.ts';

// The setup fingerprint of the synthetic fixture code, computed here so no fingerprint-shaped
// literal sits in the repo (the credential scan in tests/site.test.mjs would flag it).
const SETUP_FP = `thfp_${createHash('sha256').update(SETUP_CODE).digest('base64url')}`;

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        // Synthetic test secrets. The breach check is off: tests never call Have I Been Pwned.
        bindings: {
          AUTH_PEPPER: 'test-pepper-not-a-real-secret-0123456789',
          IP_HASH_KEY: 'test-ip-hash-key-not-a-real-secret-0123',
          AUTH_SETUP_FP: SETUP_FP,
          AUTH_RESET_FP: 'none',
          AUTH_HIBP: 'off',
          // The mind-chat trigger is not connected in tests; fire tests inject their own fetch.
          ROUTINE_CHAT_URL: 'none',
          ROUTINE_CHAT_TOKEN: 'none',
          SITE_ORIGINS: 'https://site.example.test',
        },
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
