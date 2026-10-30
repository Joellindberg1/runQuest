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

/**
 * Medan popupens chunk hämtas: skrim och en upptagen dialog, så att klicket får ett synligt svar och ingenting bakom svarar på tangentbordet. Rubrik, ✕ och Radix fokusfälla
 * kommer med chunken (och ersätter den här i samma ritning); tills dess är det här en dialog som gör tre saker, så litet som möjligt eftersom den ligger i ingångs-chunken:
 * Esc och klick på skrimman stänger (`onClose`), fokus flyttas in och stannar kvar (Tab har inget annat att gå till, så den hålls kvar i stället för att nå sidan bakom).
 * Fokus sätts i ref-callbacken och Esc/Tab fångas på dialogen själv, eftersom fokus alltid ligger där: inga effekter och ingen dokumentlyssnare, som kostade ingångs-chunken byte.
 * Dialogen heter "Runner card" (inte löparens namn) och har inget skrollås under väntan: ett namn lika med den riktiga dialogens gör att väntläget och den riktiga dialogen inte går att skilja åt för den som väntar
 * på den (proven och e2e väntar på namnet), och skrollåset kräver en effekt i ingångs-chunken. Se docs/open-assumptions.md.
 * Förladdning av chunken vid hover/fokus på en löparrad ingår inte: en dokumentlyssnare i skalet mättes till ca 150 B gzip i ingångs-chunken, och posten får växa högst 100 B (uppföljning).
 */
function PopupPending({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="rq-scrim" onClick={onClose} />
      <div
        ref={(dialog) => dialog?.focus()}
        role="dialog"
        aria-modal="true"
        aria-busy="true"
        aria-label="Runner card"
        tabIndex={-1}
        className="rq-modal"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
          else if (event.key === 'Tab') event.preventDefault();
        }}
      >
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
      <Suspense fallback={<PopupPending onClose={close} />}>
        <RunnerPopup id={id} runner={runner} users={users} failure={failure} failed={failed} onClose={close} />
      </Suspense>
    );
  }

  if (loading) return <SkeletonRows rows={4} label="Loading runner" />;
  if (!runner) return failed ? failure : <NotFound />;

  return <RunnerCard user={runner} allUsers={users} onBack={close} />;
};

export default RunnerRoute;
