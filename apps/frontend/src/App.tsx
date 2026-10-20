import React, { Suspense, lazy } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AppProviders } from '@/providers/AppProviders';
import { useAuth } from '@/providers/authContext';
import { useAppInit } from '@/shared/hooks/useAppInit';
import { usePageviewTracking } from '@/shared/analytics/usePageviewTracking';
import { RoutePending } from '@/app-shell/RoutePending';
import { StagingBanner } from '@/app-shell/StagingBanner';
import { AppRoutes } from './routes';
// Touren (driver.js) behövs först för inloggade användare, så den ligger i en egen chunk.
const OnboardingOrchestrator = lazy(() =>
  import('./features/onboarding/components/OnboardingOrchestrator').then((m) => ({ default: m.OnboardingOrchestrator })),
);


const AppContent = () => {
  const { user, loading } = useAuth();
  const path = window.location.pathname;

  useAppInit();
  usePageviewTracking({ paused: loading });

  // Strava popup-sidan hanteras som en separat HTML-fil utanför React
  if (path === '/strava-popup.html') {
    return null;
  }

  if (loading) return <RoutePending />;

  return (
    <>
      {user && (
        <Suspense fallback={null}>
          <OnboardingOrchestrator />
        </Suspense>
      )}
      <AppRoutes />
    </>
  );
};

// Stagingbannern ritas bara när bygget har VITE_APP_ENV=staging. Uttrycket står här, inte i en delad hjälpfunktion: vite.config.ts ersätter det med en konstant i bygget,
// så prodbygget tar bort både bannern och importen (och stilmallen länkas bara i stagingbygget, stagingBannerStyle.ts). Bannern är inte lazy: den står redan i den
// förrenderade index.html, och en banner som ritas först när en chunk kommit flyttade laddningsvyn under den (RUN-342).
const App = () => {
  return (
    <AppProviders>
      <BrowserRouter>
        {import.meta.env.VITE_APP_ENV === 'staging' && <StagingBanner />}
        <AppContent />
      </BrowserRouter>
    </AppProviders>
  );
};

export default App;
