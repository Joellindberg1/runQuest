import { describe, expect, it } from 'vitest';

// Designreglerna för Playbook (tokens, ikoner, rörelse, inga hårdkodade XP-siffror i komponenterna) vaktas av lint.

const sources = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('Playbook — siffrorna är inte hårdkodade', () => {
  it('modellen läser reglerna ur konfigurationen och har inga egna XP-konstanter', () => {
    const model = sources['./playbookModel.ts'];
    expect(model).toMatch(/rules\.settings/);
    expect(model).not.toMatch(/STREAK_MULTIPLIERS/);
    expect(model).not.toMatch(/base_xp:\s*\d/);
  });
});
