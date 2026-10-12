import { describe, expect, it } from 'vitest';

// Designreglerna för Login (tokens, ikoner, rörelse) vaktas av lint; en guldknapp per vy prövas i LoginDialog.test.

const sources = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('Login — dialogen', () => {
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
