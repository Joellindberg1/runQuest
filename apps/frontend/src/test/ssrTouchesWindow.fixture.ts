// Fixtur för landingBuild.test.ts: en SSR-ingång vars modul rör `window` på modulnivå, som en landningsmodul som läser bredden vid import skulle göra.
// Bygget ska falla på den (ADR 006, addendum 2026-10-19, punkt 2), inte lämna en trasig landning.
export const width = window.innerWidth;
export const renderLanding = (): string => String(width);
export const renderLoader = (): string => '';
export const renderSessionHint = (): string => 'void 0';
