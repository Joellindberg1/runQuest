import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { RoutePending } from '@/app-shell/RoutePending';
import { paths } from '@/paths';
import { UnknownAddressHandoff } from './AppHandoff';
import { LandingIndex } from './LandingIndex';

const LegalPage = lazy(() => import('@/pages/LegalPage'));

/**
 * Lean routerns tre routes (ADR 006, addendum 2026-10-19, punkt 1): `/` och `/login` (samma element på samma plats, så landningen består när dialogen öppnas),
 * `/legal` (lazy, som i fullappen) och allt annat, som lämnas över till fullappen. Skalet, huvudsidorna och touren finns inte här.
 *
 * Suspense-gränsen ligger runt `/legal` och inte runt hela routern. Varje Suspense-gräns i den förrenderade HTML:en hydreras för sig, senare än resten,
 * och en kontextändring före det (AuthProvider släpper `loading` i en effekt direkt efter första hydreringen) tvingar gränsen att klientrendera om allt
 * i den: det synliga bytet och de omstartade animationerna som förrenderingen ska undvika. Landningen står därför utanför varje gräns (hydrateLanding.test.tsx).
 */
export function LandingRoutes() {
  return (
    <Routes>
      <Route path={paths.landing} element={<LandingIndex />} />
      <Route path={paths.login} element={<LandingIndex loginOpen />} />
      <Route
        path={paths.legal}
        element={
          <Suspense fallback={<RoutePending />}>
            <LegalPage />
          </Suspense>
        }
      />
      <Route path="*" element={<UnknownAddressHandoff />} />
    </Routes>
  );
}
