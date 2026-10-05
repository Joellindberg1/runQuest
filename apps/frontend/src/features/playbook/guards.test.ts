import { describe, expect, it } from 'vitest';
import { defineDesignGuards } from '@/test/designGuards';

const sources = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '../../pages/PlaybookPage.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

defineDesignGuards({
  name: 'Playbook-filerna',
  baseUrl: import.meta.url,
  sources,
  cssFiles: ['./playbook.css'],
  tokenPrefix: '--rq-playbook-',
});

describe('Playbook — siffrorna är inte hårdkodade', () => {
  it('inga XP-värden som siffror i komponenterna: allt går via playbookModel och config', () => {
    for (const [path, text] of Object.entries(sources)) {
      if (!path.startsWith('./components/') && path !== '../../pages/PlaybookPage.tsx') continue;
      expect({ path, hardcoded: /\b(15 XP|2 XP\/km|\+5 XP|\+15 XP|\+25 XP|\+50 XP)\b/.test(text) }).toEqual({ path, hardcoded: false });
    }
  });

  it('modellen läser reglerna ur konfigurationen och har inga egna XP-konstanter', () => {
    const model = sources['./playbookModel.ts'];
    expect(model).toMatch(/rules\.settings/);
    expect(model).not.toMatch(/STREAK_MULTIPLIERS/);
    expect(model).not.toMatch(/base_xp:\s*\d/);
  });

  it('ingen shadcn-flik eller lucide-ikon kvar i sidan', () => {
    expect(sources['../../pages/PlaybookPage.tsx']).not.toMatch(/PageTabs|lucide-react|components\/ui/);
  });
});
