import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { RoutePending } from '@/app-shell/RoutePending';
import { paths } from '@/paths';
import { UnknownAddressHandoff } from './AppHandoff';
import { LandingIndex } from './LandingIndex';
import { LANDING_FILE_PATHS } from './landingAddress';
import { LandingPageviews } from './LandingPageviews';

const LegalPage = lazy(() => import('@/pages/LegalPage'));

/**
 * Lean routerns routes (ADR 006, addendum 2026-10-19, punkt 1): `/` och `/login` (samma element på samma plats, så landningen består när dialogen öppnas),
 * `/landing` och `/landing.html` (filadresserna som Caddy löser till landing.html; landningen, aldrig en överlämning, se landingAddress.ts), `/legal` (lazy, som i fullappen) och allt annat, som lämnas över till fullappen. Skalet, huvudsidorna och touren finns inte här.
 *
 * Suspense-gränsen ligger runt `/legal` och inte runt hela routern. Varje Suspense-gräns i den förrenderade HTML:en hydreras för sig, senare än resten,
 * och en kontextändring före det (AuthProvider släpper `loading` i en effekt direkt efter första hydreringen) tvingar gränsen att klientrendera om allt
 * i den: det synliga bytet och de omstartade animationerna som förrenderingen ska undvika. Landningen står därför utanför varje gräns (hydrateLanding.test.tsx).
 */
export function LandingRoutes() {
  return (
    <>
      <Routes>
        <Route path={paths.landing} element={<LandingIndex />} />
        <Route path={paths.login} element={<LandingIndex loginOpen />} />
        {/* Caddys try_files ger landing.html också här. Samma element på samma plats: landningen ritas inte om när adressen skrivs om till /. */}
        {LANDING_FILE_PATHS.map((path) => (
          <Route key={path} path={path} element={<LandingIndex canonicalizeAddress />} />
        ))}
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
      {/* Efter Routes: överlämningens effekt (som stänger sändaren) körs då före sidvisningens. Renderar ingenting, så förrenderingen berörs inte. */}
      <LandingPageviews />
    </>
  );
}
