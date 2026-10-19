import { useCallback, useEffect, useState } from 'react';
import { matchPath, Outlet, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { paths } from '@/paths';
import { USERS_WITH_RUNS_QUERY_KEY, useUsersWithRuns } from '@/shared/hooks/useUsersWithRuns';
import { RoutePending } from './RoutePending';

/**
 * Längsta tid laddningsvyn står kvar när topplistan varken svarat eller misslyckats, alltså ett hängt anrop (backendApi har ingen timeout). En långsam
 * men levande förfrågan på mobilnät eller mot en kallstartad backend ryms med marginal; efter taket är skalet med sin navigering och Boards egen laddning
 * en bättre plats att vänta på än en ensam oval.
 */
export const FIRST_BOARD_DATA_MAX_WAIT_MS = 8_000;

function HoldUntilStandings({ onDone }: { onDone: () => void }) {
  // Hämtningen startar här, inte i Board: sidan monteras först när gaten släppt.
  const query = useUsersWithRuns(true);
  // Första misslyckade försöket räcker. Släpps gaten först när omförsöken är slut och felet slutgiltigt, startar Boards nya observatörer om hämtningen
  // (retryOnMount) och ger ytterligare en omgång omförsök bakom en laddning, så felvyn dröjer dubbelt. Släpps den medan omförsöken pågår
  // fortsätter samma hämtning och Board visar sin vanliga väg: laddning, sedan felvy.
  const answered = query.isSuccess || query.isError || query.failureCount > 0;

  useEffect(() => {
    if (answered) onDone();
  }, [answered, onDone]);

  useEffect(() => {
    const timer = setTimeout(onDone, FIRST_BOARD_DATA_MAX_WAIT_MS);
    return () => clearTimeout(timer);
  }, [onDone]);

  return <RoutePending />;
}

/**
 * Första laddningen av /board (ADR 006, addendum 2026-10-19, punkt 11): appens laddningsvy står kvar tills topplistans första svar finns, så att
 * ingen bildruta visar Board med tomma podieplatser. Skalet och sidan monteras först när gaten släppt, så vyn är samma bild på samma plats som
 * i index.html. Gaten avgörs en gång, när den monteras, och släpper bara en väg: senare navigering, bakgrundsuppdateringar och andra sidor
 * ser den aldrig. Misslyckas hämtningen eller drar den över taket släpps gaten, och Board visar sin egen laddning eller felvy.
 */
export function FirstBoardGate() {
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const [holding, setHolding] = useState(() => matchPath(paths.board, pathname) !== null && queryClient.getQueryData(USERS_WITH_RUNS_QUERY_KEY) === undefined);
  const release = useCallback(() => setHolding(false), []);

  return holding ? <HoldUntilStandings onDone={release} /> : <Outlet />;
}
