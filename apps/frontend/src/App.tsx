import React, { Suspense, lazy } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AppProviders } from '@/providers/AppProviders';
import { useAuth } from '@/providers/authContext';
import { useAppInit } from '@/shared/hooks/useAppInit';
import { TrackLoader } from '@/shared/components/loaders/TrackLoader';
import { AppRoutes } from './routes';
// Touren (driver.js) behövs först för inloggade användare, så den ligger i en egen chunk.
const OnboardingOrchestrator = lazy(() =>
  import('./features/onboarding/components/OnboardingOrchestrator').then((m) => ({ default: m.OnboardingOrchestrator })),
);

// Stagingbannern laddas som egen chunk och bara när bygget har VITE_APP_ENV=staging. Uttrycket står här, inte i en delad hjälpfunktion: vite.config.ts
// ersätter det med en konstant i bygget, så prodbygget tar bort både chunken och bannerns CSS (landningens budget rörs inte).
let stagingBanner: ReturnType<typeof lazy> | undefined;
const getStagingBanner = () => {
  if (import.meta.env.VITE_APP_ENV !== 'staging') return null;
  stagingBanner ??= lazy(() => import('@/app-shell/StagingBanner').then((m) => ({ default: m.StagingBanner })));
  return stagingBanner;
};

const AppContent = () => {
  const { user, loading } = useAuth();
  const path = window.location.pathname;

  useAppInit();

  // Strava popup-sidan hanteras som en separat HTML-fil utanför React
  if (path === '/strava-popup.html') {
    return null;
  }

  if (loading) {
    return (
      <div className="rq-shell__pending">
        <TrackLoader size={64} label="Loading" />
      </div>
    );
  }

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

const App = () => {
  const StagingBanner = getStagingBanner();
  return (
    <AppProviders>
      <BrowserRouter>
        {StagingBanner && (
          <Suspense fallback={null}>
            <StagingBanner />
          </Suspense>
        )}
        <AppContent />
      </BrowserRouter>
    </AppProviders>
  );
};

export default App;
