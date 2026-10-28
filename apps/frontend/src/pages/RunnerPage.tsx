import React, { Suspense, lazy } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '@/providers/authContext';
import { useLeaderboardData } from '@/features/leaderboard/hooks/useLeaderboardData';
import { RunnerCard } from '@/features/runner/components/RunnerCard';
import { ErrorState } from '@/shared/components/ErrorState';
import { SkeletonRows } from '@/shared/components/loaders/SkeletonRows';
import { useCloseRunner } from '@/shared/hooks/useOpenRunner';
import { paths } from '@/paths';
import NotFound from './NotFound';

// Profil-popupen (dialogram och innehåll) är en egen chunk (ADR 006 addendum 2026-10-26, beslut 1): den får aldrig hamna i fullappens ingångs-chunk.
const RunnerPopup = lazy(() => import('@/features/runner/components/RunnerPopup').then((module) => ({ default: module.RunnerPopup })));

interface RunnerRouteProps {
  /** `page`: egen sida i skalet (mobil, direktladdning). `overlay`: profil-popupen ovanpå bakgrundssidan (desktop). */
  presentation: 'page' | 'overlay';
}

/** Medan popupens chunk hämtas: skrim och laddare, så att klicket får ett synligt svar. Dialogen själv (rubrik, ✕, fokus) kommer med chunken. */
function PopupPending() {
  return (
    <>
      <div className="rq-scrim" />
      <div className="rq-modal">
        <SkeletonRows rows={4} label="Loading runner" />
      </div>
    </>
  );
}

/** /runner/:id (ADR 006 beslut 6). Eget id → /profile; okänt id → NotFound i skalet. */
export const RunnerRoute: React.FC<RunnerRouteProps> = ({ presentation }) => {
  const { id = '' } = useParams();
  const { user: authUser } = useAuth();
  const location = useLocation();
  const close = useCloseRunner();
  const { users, loading, failed, retrying, refresh } = useLeaderboardData();

  if (authUser && id === authUser.id) return <Navigate to={paths.profile} replace />;

  const runner = users.find((u) => u.id === id);
  // Ett misslyckat anrop är inte "okänd löpare": felkortet med Retry, aldrig NotFound.
  const failure = (
    <ErrorState title="Couldn't load this runner" retrying={retrying} onRetry={() => void refresh()} />
  );

  if (presentation === 'overlay') {
    // Okänt id: släpp bakgrunden så att sidvarianten visar NotFound i skalet.
    if (!loading && !failed && !runner) return <Navigate to={{ pathname: location.pathname, search: location.search }} replace state={null} />;

    return (
      <Suspense fallback={<PopupPending />}>
        <RunnerPopup id={id} runner={runner} users={users} failure={failure} failed={failed} onClose={close} />
      </Suspense>
    );
  }

  if (loading) return <SkeletonRows rows={4} label="Loading runner" />;
  if (!runner) return failed ? failure : <NotFound />;

  return <RunnerCard user={runner} allUsers={users} onBack={close} />;
};

export default RunnerRoute;
