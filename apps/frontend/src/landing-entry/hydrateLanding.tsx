import { lazy } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { AppBrowserRouter } from '@/app-shell/AppBrowserRouter';
import { log } from '@/shared/utils/logger';
import { LandingApp } from './LandingApp';

// Stagingbannern laddas som egen chunk och bara när bygget har VITE_APP_ENV=staging. Uttrycket står här, inte i en delad hjälpfunktion: vite.config.ts
// ersätter det med en konstant i bygget, så prodbygget tar bort både chunken och bannerns CSS. Samma mönster som App.tsx.
let stagingBanner: ReturnType<typeof lazy> | undefined;
const getStagingBanner = () => {
  if (import.meta.env.VITE_APP_ENV !== 'staging') return null;
  stagingBanner ??= lazy(() => import('@/app-shell/StagingBanner').then((m) => ({ default: m.StagingBanner })));
  return stagingBanner;
};

// Ett återställbart fel betyder att React kastade bort delträdet och klientrenderade det (ofta ett webbläsartillägg som ändrat DOM:en före hydreringen).
// Det loggas men rapporteras inte: besökaren ser en fungerande sida och det finns inget att åtgärda i koden.
const logRecoverable = (error: unknown) => log.warn('Recoverable hydration error on the landing', error);

interface HydrateOptions {
  onRecoverableError?: (error: unknown) => void;
}

/**
 * Hydrerar den förrenderade landningen i `container` (ADR 006, addendum 2026-10-19, punkt 1 och 9). Klientens första rendering är identisk med
 * serverns: samma träd (LandingApp), inget val på bredd, ingen data. Stagingbannern är lazy här men en vanlig komponent på servern; Suspense-gränsen
 * gör att React behåller serverns HTML tills chunken är laddad.
 */
export function hydrateLanding(container: HTMLElement, { onRecoverableError = logRecoverable }: HydrateOptions = {}): Root {
  return hydrateRoot(container, <LandingApp Router={AppBrowserRouter} StagingBanner={getStagingBanner()} />, { onRecoverableError });
}
