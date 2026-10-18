import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@runquest/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    // ADR 013 decision 11: an open, fixed test key (32 bytes of readable text, not a secret) so the Strava tests, whose fakes hold token
    // rows, run with encryption on. It is set here and nowhere else; a test that wants no key stubs the variable to an empty string.
    // The retired list is pinned to empty too: a list (or a duplicate of test-1) in the developer's shell must not decide the suite.
    env: { TOKEN_ENCRYPTION_KEY: 'test-1:cnVucXVlc3Qtb3Blbi10ZXN0LWtleS1uby1zZWNyZXQ=', TOKEN_ENCRYPTION_KEYS_RETIRED: '' },
  },
});
