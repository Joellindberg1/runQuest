import React from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { useAuth } from '@/providers/authContext';
import { useLeaderboardData } from '@/features/leaderboard/hooks/useLeaderboardData';
import { RunnerCard } from '@/features/runner/components/RunnerCard';
import { ErrorState } from '@/shared/components/ErrorState';
import { SkeletonRows } from '@/shared/components/loaders/SkeletonRows';
import { useCloseRunner } from '@/shared/hooks/useOpenRunner';
import { paths } from '@/paths';
import NotFound from './NotFound';

interface RunnerRouteProps {
  /** `page`: egen sida i skalet (mobil, direktladdning). `overlay`: ovanpå bakgrundssidan (desktop). */
  presentation: 'page' | 'overlay';
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
      <Dialog.Root open onOpenChange={(open) => { if (!open) close(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="rq-scrim" />
          <Dialog.Content className="rq-modal" aria-describedby={undefined}>
            <Dialog.Title className="sr-only">{runner?.name ?? 'Runner card'}</Dialog.Title>
            <Dialog.Close className="rq-modal__close" aria-label="Close">✕</Dialog.Close>
            {runner ? <RunnerCard user={runner} allUsers={users} variant="overlay" /> : failed ? failure : <SkeletonRows rows={4} label="Loading runner" />}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  if (loading) return <SkeletonRows rows={4} label="Loading runner" />;
  if (!runner) return failed ? failure : <NotFound />;

  return <RunnerCard user={runner} allUsers={users} variant="page" onBack={close} />;
};

export default RunnerRoute;
