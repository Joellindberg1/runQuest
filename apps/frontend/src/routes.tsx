import React, { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/providers/authContext';
import { paths } from '@/paths';
import { RequireAuth } from '@/app-shell/RequireAuth';
import { RoutePending } from '@/app-shell/RoutePending';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { legacyChallengesTarget } from '@/app-shell/legacyRedirects';
import { ShellErrorBoundary } from '@/app-shell/ShellErrorBoundary';
import { readBackground, useCloseRunner } from '@/shared/hooks/useOpenRunner';
// Skalets delade lager (.rq-scrim, .rq-modal, .rq-shell__pending) används även av landningens inloggningsdialog och App.tsx:s laddningsbild,
// så CSS:en ska ligga i startpaketet och inte följa med skal-chunken.
import '@/app-shell/app-shell.css';

// Varje sida är en egen chunk (ADR 006 beslut 11): landningen laddar varken skalet, sidorna eller touren (driver.js).
// Suspense-gränsen för sidorna inne i skalet ligger i ShellOutlet; AppRoutes har en för allt utanför.
const Index = lazy(() => import('@/pages/Index'));
const AppShell = lazy(() => import('@/app-shell/AppShell').then((m) => ({ default: m.AppShell })));
const BoardPage = lazy(() => import('@/pages/BoardPage'));
const TitlesPage = lazy(() => import('@/pages/TitlesPage'));
const DuelsPage = lazy(() => import('@/pages/DuelsPage'));
const EventsPage = lazy(() => import('@/pages/EventsPage'));
const NewsPage = lazy(() => import('@/pages/NewsPage'));
const LogPage = lazy(() => import('@/pages/LogPage'));
const ProfilePage = lazy(() => import('@/pages/ProfilePage'));
const BadgesPage = lazy(() => import('@/pages/BadgesPage'));
const RunnerRoute = lazy(() => import('@/pages/RunnerPage'));
const NotFound = lazy(() => import('@/pages/NotFound'));
const LeaderboardPreviewPage = lazy(() => import('@/pages/LeaderboardPreviewPage'));
const ChallengesPreviewPage = lazy(() => import('@/pages/ChallengesPreviewPage'));
const BadgesPreviewPage = lazy(() => import('@/pages/BadgesPreviewPage'));
const AdminPage = lazy(() => import('@/pages/AdminPage'));
const PlaybookPage = lazy(() => import('@/pages/PlaybookPage'));
const FeaturesPage = lazy(() => import('@/pages/FeaturesPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));

const AdminRoute: React.FC = () => {
  const { isAdmin } = useAuth();
  return isAdmin ? <AdminPage /> : <Navigate to={paths.board} replace />;
};

const LegacyChallengesRedirect: React.FC = () => {
  const { search } = useLocation();
  return <Navigate to={legacyChallengesTarget(search)} replace />;
};

/**
 * Routeträdet (ADR 006 beslut 1): RequireAuth → AppShell → sidor. På desktop renderas
 * `/runner/:id` som overlay över bakgrundssidan ("background location"): trädet matchas mot
 * `background`, så skalet och sidan står kvar, och overlayn läggs ovanpå.
 */
export const AppRoutes: React.FC = () => {
  const location = useLocation();
  const isDesktop = useIsDesktop();
  const background = isDesktop ? readBackground(location) : undefined;
  const closeOverlay = useCloseRunner();

  return (
    <>
      <Suspense fallback={<RoutePending />}>
        <Routes location={background ?? location}>
          <Route path={paths.landing} element={<Index />} />
          {/* Login är Landing med dialogen öppen: samma element på samma plats, så Landing består när dialogen öppnas (se Index). */}
          <Route path={paths.login} element={<Index loginOpen />} />
          <Route path={paths.legacyChallenges} element={<LegacyChallengesRedirect />} />
          <Route path={paths.previewBoard} element={<LeaderboardPreviewPage />} />
          <Route path={paths.previewDuels} element={<ChallengesPreviewPage />} />
          <Route path={paths.previewBadges} element={<BadgesPreviewPage />} />

          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route path={paths.board} element={<BoardPage />} />
              <Route path={paths.titles} element={<TitlesPage />} />
              <Route path={paths.duels} element={<DuelsPage />} />
              <Route path={paths.events} element={<EventsPage />} />
              <Route path={paths.news} element={<NewsPage />} />
              <Route path={paths.log} element={<LogPage />} />
              <Route path={paths.profile} element={<ProfilePage />} />
              <Route path={paths.badges} element={<BadgesPage />} />
              <Route path={paths.runnerPattern} element={<RunnerRoute presentation="page" />} />
              <Route path={paths.playbook} element={<PlaybookPage />} />
              <Route path={paths.features} element={<FeaturesPage />} />
              <Route path={paths.settings} element={<SettingsPage />} />
              <Route path={paths.admin} element={<AdminRoute />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Route>
        </Routes>
      </Suspense>

      {background && (
        <ShellErrorBoundary key={location.pathname} onClose={closeOverlay}>
          <Suspense fallback={null}>
            <Routes>
              <Route path={paths.runnerPattern} element={<RunnerRoute presentation="overlay" />} />
            </Routes>
          </Suspense>
        </ShellErrorBoundary>
      )}
    </>
  );
};

