import React, { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/providers/authContext';
import { paths } from '@/paths';
import { AppShell } from '@/app-shell/AppShell';
import { FirstBoardGate } from '@/app-shell/FirstBoardGate';
import { PendingNavigate } from '@/app-shell/PendingNavigate';
import { RequireAuth } from '@/app-shell/RequireAuth';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { legacyChallengesTarget } from '@/app-shell/legacyRedirects';
import { ShellErrorBoundary } from '@/app-shell/ShellErrorBoundary';
import { useRestoreRunnerFocus } from '@/app-shell/useRestoreRunnerFocus';
import { readBackground, useCloseRunner } from '@/shared/hooks/useOpenRunner';
import { RoutePending } from '@/app-shell/RoutePending';
// Skalets delade lager (.rq-scrim, .rq-modal) används även av landningens inloggningsdialog. Laddningsvyns ram (.rq-shell__pending) ligger i shell-pending.css och följer med RoutePending.
// Det är den enda statiska CSS-importen här (se routes.guard.test.ts); övrig feature-CSS följer med sina moduler.
import '@/app-shell/app-shell.css';
import BoardPage from '@/pages/BoardPage';
import TitlesPage from '@/pages/TitlesPage';
import DuelsPage from '@/pages/DuelsPage';
import EventsPage from '@/pages/EventsPage';
import NewsPage from '@/pages/NewsPage';
import LogPage from '@/pages/LogPage';
import ProfilePage from '@/pages/ProfilePage';
import BadgesPage from '@/pages/BadgesPage';
import RunnerRoute from '@/pages/RunnerPage';
import NotFound from '@/pages/NotFound';

// Lazy (ADR 006 beslut 11): sällan besökta sidor, landningen, preview-sidorna och touren (driver.js, via App.tsx). Skalet och huvudsidorna är
// eager. Suspense-gränsen för sidorna inne i skalet ligger i ShellOutlet; AppRoutes har en för landning och preview.
const Index = lazy(() => import('@/pages/Index'));
const LeaderboardPreviewPage = lazy(() => import('@/pages/LeaderboardPreviewPage'));
const ChallengesPreviewPage = lazy(() => import('@/pages/ChallengesPreviewPage'));
const BadgesPreviewPage = lazy(() => import('@/pages/BadgesPreviewPage'));
const LegalPage = lazy(() => import('@/pages/LegalPage'));
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
  return <PendingNavigate to={legacyChallengesTarget(search)} />;
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
  // Här och inte i ShellOutlet: `<Routes location={background}>` ger skalets `useLocation` bakgrundssidan medan popupen är öppen, så skalet ser aldrig popupen stängas.
  useRestoreRunnerFocus();

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
          <Route path={paths.legal} element={<LegalPage />} />

          <Route element={<RequireAuth />}>
            {/* Håller laddningsvyn kvar på första laddningen av /board tills topplistan svarat; på alla andra vägar är den en genomgång. */}
            <Route element={<FirstBoardGate />}>
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
          </Route>
        </Routes>
      </Suspense>

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

