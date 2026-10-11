import { describe, expect, it } from 'vitest';

// O2 (ägarbeslut 2026-10-11, spec F9.12): INGEN global procent. Räknaren är bara "Held by X of N in your pack" (ADR 009: allt gruppavgränsat).
// "N% globally" och "Global — N% has it" stryks överallt: kort, tooltips, popover. Vakten läser alla källfiler i featuren (utom tester) och
// kräver att ingen sträng nämner dem — så en framtida vy inte kan smuggla tillbaka dem.

const sources = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./**/*.fixture.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('badges-featuren: ingen global procent (O2)', () => {
  it('hittar källfilerna, inklusive de nya byggstenarna', () => {
    const paths = Object.keys(sources);
    expect(paths).toEqual(expect.arrayContaining(['./badgeModel.ts', './hooks/useShowcaseDraft.ts', './components/BadgeSeriesCard.tsx', './components/BadgeEmblemDetail.tsx']));
  });

  it('inga strängar med "globally", "has it" eller ett procenttecken någonstans i featurens kod', () => {
    for (const [path, text] of Object.entries(sources)) {
      const body = code(text);
      expect({ path, globally: /globally/i.test(body), hasIt: /\bhas it\b/i.test(body), percent: body.includes('%') }).toEqual({ path, globally: false, hasIt: false, percent: false });
    }
  });

  it('"in pack" skrivs aldrig utan "your" (L9: "in your pack" överallt)', () => {
    for (const [path, text] of Object.entries(sources)) expect({ path, bare: /in pack\b/i.test(code(text)) }).toEqual({ path, bare: false });
  });
});
