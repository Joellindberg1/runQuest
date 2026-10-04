import React, { lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/providers/authContext';
import { paths } from '@/paths';
import { AppShell } from '@/app-shell/AppShell';
import { RequireAuth } from '@/app-shell/RequireAuth';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { legacyChallengesTarget } from '@/app-shell/legacyRedirects';
import { resolveNextPath } from '@/app-shell/safeNext';
import { ShellErrorBoundary } from '@/app-shell/ShellErrorBoundary';
import { readBackground, useCloseRunner } from '@/shared/hooks/useOpenRunner';
import Index from '@/pages/Index';
import LoginPage from '@/pages/LoginPage';
import BoardPage from '@/pages/BoardPage';
import TitlesPage from '@/pages/TitlesPage';
import DuelsPage from '@/pages/DuelsPage';
import EventsPage from '@/pages/EventsPage';
import NewsPage from '@/pages/NewsPage';
import LogPage from '@/pages/LogPage';
import ProfilePage from '@/pages/ProfilePage';
import RunnerRoute from '@/pages/RunnerPage';
import NotFound from '@/pages/NotFound';
import LeaderboardPreviewPage from '@/pages/LeaderboardPreviewPage';
import ChallengesPreviewPage from '@/pages/ChallengesPreviewPage';

// Sällan besökta sidor laddas först när de behövs (ADR 006 beslut 11); Suspense-gränsen ligger i ShellOutlet.
const AdminPage = lazy(() => import('@/pages/AdminPage'));
const PlaybookPage = lazy(() => import('@/pages/PlaybookPage'));
const FeaturesPage = lazy(() => import('@/pages/FeaturesPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));

const LoginRoute: React.FC = () => {
  const { user } = useAuth();
  const { search } = useLocation();
  return user ? <Navigate to={resolveNextPath(search)} replace /> : <LoginPage />;
};

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
      <Routes location={background ?? location}>
        <Route path="/" element={<Index />} />
        <Route path={paths.login} element={<LoginRoute />} />
        <Route path={paths.legacyChallenges} element={<LegacyChallengesRedirect />} />
        <Route path={paths.previewBoard} element={<LeaderboardPreviewPage />} />
        <Route path={paths.previewDuels} element={<ChallengesPreviewPage />} />

        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route path={paths.board} element={<BoardPage />} />
            <Route path={paths.titles} element={<TitlesPage />} />
            <Route path={paths.duels} element={<DuelsPage />} />
            <Route path={paths.events} element={<EventsPage />} />
            <Route path={paths.news} element={<NewsPage />} />
            <Route path={paths.log} element={<LogPage />} />
            <Route path={paths.profile} element={<ProfilePage />} />
            <Route path={paths.runnerPattern} element={<RunnerRoute presentation="page" />} />
            <Route path={paths.playbook} element={<PlaybookPage />} />
            <Route path={paths.features} element={<FeaturesPage />} />
            <Route path={paths.settings} element={<SettingsPage />} />
            <Route path={paths.admin} element={<AdminRoute />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Routes>

      {background && (
        <ShellErrorBoundary key={location.pathname} onClose={closeOverlay}>
          <Routes>
            <Route path={paths.runnerPattern} element={<RunnerRoute presentation="overlay" />} />
          </Routes>
        </ShellErrorBoundary>
      )}
    </>
  );
};

