import { Suspense, type ComponentType, type ReactNode } from 'react';
import { AppProviders } from '@/providers/AppProviders';
import { LandingRoutes } from './LandingRoutes';

interface LandingAppProps {
  /** AppBrowserRouter i webbläsaren, StaticRouter vid bygget: det enda som skiljer serverns träd från klientens. */
  Router: ComponentType<{ children: ReactNode }>;
  /** Stagingbannern, bara i en stagingbyggd frontend. Klienten skickar en lazy-komponent och bygget en vanlig; Suspense-gränsen är densamma. */
  StagingBanner?: ComponentType | null;
}

/**
 * Hela lean ingångens träd (ADR 006, addendum 2026-10-19, punkt 1 och 9). Serverrenderingen (landing-ssr.tsx) och hydreringen (hydrateLanding.tsx)
 * renderar samma komponent med varsin router: samma providers, samma ordning, så `useId` och DOM-strukturen stämmer.
 *
 * Stagingbannern ligger utanför providers: en Suspense-gräns i serverns HTML hydreras för sig och senare, och ändrar någon provider sitt värde före det
 * (AuthProvider släpper `loading`, ThemeProvider läser temat, båda i en effekt direkt efter första hydreringen) klientrenderar React om gränsen.
 * Bannern behöver ingen kontext, så den står över dem (hydrateLanding.test.tsx). Den ligger först i flödet precis som i fullappen.
 */
export function LandingApp({ Router, StagingBanner }: LandingAppProps) {
  return (
    <>
      {StagingBanner && (
        <Suspense fallback={null}>
          <StagingBanner />
        </Suspense>
      )}
      <AppProviders>
        <Router>
          <LandingRoutes />
        </Router>
      </AppProviders>
    </>
  );
}
