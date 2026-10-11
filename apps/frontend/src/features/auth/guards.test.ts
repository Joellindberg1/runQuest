import { describe, expect, it } from 'vitest';
import { defineDesignGuards } from '@/test/designGuards';

const sources = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], {
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

describe('Login — dialogen (RUN-145)', () => {
  const dialog = sources['./components/LoginDialog.tsx'];

  it('återanvänder skalets delade lager (Radix Dialog + .rq-scrim/.rq-modal) i stället för egen mörkläggning och egen fokusfälla', () => {
    expect(dialog).toMatch(/@radix-ui\/react-dialog/);
    expect(dialog).toMatch(/rq-scrim/);
    expect(dialog).toMatch(/rq-modal/);
  });

  it('dialogen är modal med titel och beskrivning (aria-modal, Dialog.Title, Dialog.Description)', () => {
    expect(dialog).toMatch(/aria-modal="true"/);
    expect(dialog).toMatch(/Dialog\.Title/);
    expect(dialog).toMatch(/Dialog\.Description/);
  });

  it('inloggningen är inte längre en egen sida: inga LoginScreen/LoginPage, och ingen egen glöd/logotyp (de ligger på Landing bakom dialogen)', () => {
    expect(Object.keys(sources).filter((path) => /LoginScreen|LoginPage/.test(path))).toEqual([]);
    expect(dialog).not.toMatch(/RQLogo/);
  });
});

describe('Login — regel 3 (en guldknapp per vy)', () => {
  it('formuläret har exakt en guldknapp', () => {
    const count = Object.values(sources).reduce((sum, text) => sum + (text.match(/rq-btn--primary/g) ?? []).length, 0);
    expect(count).toBe(1);
  });
});
