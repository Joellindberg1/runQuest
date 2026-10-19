// Fixtur för landingBuild.test.ts: en SSR-ingång som renderar det läge (mode) SSR-bygget fick, så att testet kan se att förrenderingen bygger i samma läge som
// klientbygget (annars läser de olika .env.<mode>-filer och förrenderingen kan skilja sig från klienten, vilket ger en hydreringsmismatch).
export const renderLanding = (): string => import.meta.env.MODE;
export const renderLoader = (): string => '';
export const renderSessionHint = (): string => 'void 0';
export const renderLoaderPhase = (): string => 'void 0';
