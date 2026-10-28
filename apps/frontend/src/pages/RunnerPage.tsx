import React, { Suspense, lazy, useRef } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import type { User } from '@runquest/types';
import { useAuth } from '@/providers/authContext';
import { useLeaderboardData } from '@/features/leaderboard/hooks/useLeaderboardData';
import { ChallengeButton } from '@/features/runner/components/ChallengeButton';
import { RunnerCard } from '@/features/runner/components/RunnerCard';
import { useHeadToHead } from '@/features/runner/hooks/useRunnerQueries';
import { ErrorState } from '@/shared/components/ErrorState';
import { SkeletonRows } from '@/shared/components/loaders/SkeletonRows';
import { useCloseRunner } from '@/shared/hooks/useOpenRunner';
import { findRunnerElement } from '@/shared/utils/findRunnerElement';
import { paths } from '@/paths';
import NotFound from './NotFound';

// Popupens innehåll är en egen chunk (ADR 006 addendum 2026-10-26, beslut 1): den får aldrig hamna i fullappens ingångs-chunk. Ramen nedan är eager, så scrim, rubrik och ✕ står
// där direkt och bara innehållet väntar på sin chunk.
const RunnerPopup = lazy(() => import('@/features/runner/components/RunnerPopup').then((module) => ({ default: module.RunnerPopup })));

interface RunnerRouteProps {
  /** `page`: egen sida i skalet (mobil, direktladdning). `overlay`: profil-popupen ovanpå bakgrundssidan (desktop). */
  presentation: 'page' | 'overlay';
}

/** Challenge i popupens rad: head-to-head avgör om knappen blir en statuschip (samma fråga som panelen, så den delas i cachen). */
function PopupChallenge({ runnerId, onFollow }: { runnerId: string; onFollow: () => void }) {
  const headToHead = useHeadToHead(runnerId);
  return <ChallengeButton opponentId={runnerId} active={headToHead.data?.active?.status ?? null} onFollow={onFollow} />;
}

interface RunnerDialogProps {
  /** Löparen i adressen. */
  id: string;
  /** Löparen, eller undefined medan gruppen laddar eller har felat. */
  runner: User | undefined;
  users: User[];
  failure: React.ReactNode;
  failed: boolean;
  onClose: () => void;
}

/**
 * Profil-popupens dialogram (ADR 006 addendum 2026-10-26, beslut 2): Radix Dialog över skalets `.rq-scrim`/`.rq-modal`. Fast huvudyta (rubrik, Challenge, ✕) och en
 * scrollande yta för innehållet, så dialogen aldrig blir högre än fönstret.
 * - Fokus in: rubriken (`tabIndex={-1}`), så att skärmläsaren läser dialogens namn före första knappen. Fokusfällan, Esc och klick på skrimman är Radix, alla via
 *   `onClose` (`useCloseRunner`).
 * - Fokus tillbaka: dialogen har ingen Trigger, och Safari och Firefox på Mac fokuserar inte en knapp vid klick, så Radix standard räcker inte. Efter stängning fokuseras
 *   det första synliga `[data-runner-id]` för löparen i bakgrundssidan. Det sker i `onCloseAutoFocus` (som Radix kör först när dialogen är borta), inte medan den är öppen:
 *   bakgrunden är då `aria-hidden` och ofokuserbar. Finns ingen rad gäller Radix standard. Lämnar Challenge popupen går användaren till en annan sida, och då får fokus
 *   inte dras till en rad där.
 */
function RunnerDialog({ id, runner, users, failure, failed, onClose }: RunnerDialogProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const leftByNavigation = useRef(false);

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="rq-scrim" />
        <Dialog.Content
          className="rq-modal rq-runner-popup"
          aria-modal="true"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            titleRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            if (leftByNavigation.current) return;
            const row = findRunnerElement(id);
            if (!row) return;
            event.preventDefault();
            row.focus();
          }}
        >
          <div className="rq-runner-popup__bar">
            <Dialog.Title ref={titleRef} tabIndex={-1} className="rq-runner-popup__title">
              {/* Det som syns är "Runner card"; namnet är skärmläsartext. En sr-only-fortsättning efter den synliga texten ger "Runner card : Karl Persson" i Chrome (spans med
                  position absolute räknas som block och får mellanrum runt sig), så den synliga delen göms för hjälpmedel och sr-only-delen bär hela namnet. */}
              <span aria-hidden={runner ? true : undefined}>Runner card</span>
              {runner && <span className="sr-only">Runner card: {runner.name}</span>}
            </Dialog.Title>
            <span className="rq-runner__spacer" />
            {runner && <PopupChallenge runnerId={runner.id} onFollow={() => { leftByNavigation.current = true; }} />}
          </div>
          <Dialog.Close className="rq-modal__close" aria-label="Close">✕</Dialog.Close>
          <div className="rq-runner-popup__content">
            {runner ? (
              <Suspense fallback={<SkeletonRows rows={4} label="Loading runner" />}>
                <RunnerPopup key={runner.id} user={runner} allUsers={users} />
              </Suspense>
            ) : failed ? failure : (
              <SkeletonRows rows={4} label="Loading runner" />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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

    return <RunnerDialog id={id} runner={runner} users={users} failure={failure} failed={failed} onClose={close} />;
  }

  if (loading) return <SkeletonRows rows={4} label="Loading runner" />;
  if (!runner) return failed ? failure : <NotFound />;

  return <RunnerCard user={runner} allUsers={users} onBack={close} />;
};

export default RunnerRoute;
