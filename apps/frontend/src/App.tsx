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

const App = () => (
  <AppProviders>
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  </AppProviders>
);

export default App;
