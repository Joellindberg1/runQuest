import { describe, expect, it } from 'vitest';
import { defineDesignGuards } from '@/test/designGuards';

const sources = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '../../pages/LoginPage.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

defineDesignGuards({
  name: 'Login-filerna',
  baseUrl: import.meta.url,
  sources,
  cssFiles: ['./login.css'],
  tokenPrefix: '--rq-login-',
});

describe('Login — regel 3 (en guldknapp per vy)', () => {
  it('formuläret har exakt en guldknapp', () => {
    const count = Object.values(sources).reduce((sum, text) => sum + (text.match(/rq-btn--primary/g) ?? []).length, 0);
    expect(count).toBe(1);
  });
});
