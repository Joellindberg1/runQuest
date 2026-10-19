import { useCallback, useEffect, useState } from 'react';
import { matchPath, Outlet, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { paths } from '@/paths';
import { BOARD_VIEWS, DEFAULT_BOARD_VIEW } from '@/features/leaderboard/boardViews';
import { useSeasonBoardData } from '@/features/leaderboard/hooks/useSeasonBoardData';
import { USERS_WITH_RUNS_QUERY_KEY } from '@/shared/hooks/useUsersWithRuns';
import { useViewParam } from '@/shared/hooks/useViewParam';
import { RoutePending } from './RoutePending';

/**
 * Längsta tid laddningsvyn står kvar, räknat från att gaten monteras och för HELA kedjan (gruppen, sedan titlarna, plus pilarna och minis som går
 * parallellt). Taket gäller ett hängt anrop (backendApi har ingen timeout). En långsam men levande förfrågan på mobilnät eller mot en kallstartad backend
 * ryms med marginal; efter taket är skalet med sin navigering och Boards egen laddning en bättre plats att vänta på än en ensam oval.
 * Måste vara kortare än USERS_WITH_RUNS_STALE_MS, annars hämtar sidan om gruppen när gaten släpper.
 */
export const FIRST_BOARD_DATA_MAX_WAIT_MS = 8_000;

interface Settled {
  data: unknown;
  isError: boolean;
  failureCount: number;
}

/** Ett första misslyckat försök räcker: omförsöken pågår då under Board (se HoldUntilBoardData). */
const hasFailed = (query: Settled) => query.isError || query.failureCount > 0;

function HoldUntilBoardData({ onDone }: { onDone: () => void }) {
  // Season-vyn ritar titlar, pilar och badge-minis i podiekorten; Week och Streaks gör det inte och väntar bara på gruppen.
  const [view] = useViewParam(BOARD_VIEWS, DEFAULT_BOARD_VIEW);
  const decorations = view === 'season';
  // Hämtningen startar här, inte i Board (sidan är inte monterad än), men med Boards egna frågor och nycklar: Board läser sedan cachen och hämtar inget om.
  const { usersQuery, ranked, titlesQuery, rankDeltaQuery, groupBadgesQuery } = useSeasonBoardData(decorations);

  // Titlarna hämtas bara när gruppen har löpare; en tom grupp visar "No runners yet" utan podium.
  const decorationsArrived =
    rankDeltaQuery.data !== undefined && groupBadgesQuery.data !== undefined && (ranked.length === 0 || titlesQuery.data !== undefined);
  const arrived = usersQuery.data !== undefined && (!decorations || decorationsArrived);
  // Släpps gaten först när omförsöken är slut och felet slutgiltigt, startar Boards nya observatörer om hämtningen (retryOnMount) och ger en ny omgång
  // omförsök bakom en laddning, så felvyn dröjer dubbelt. Släpps den medan omförsöken pågår fortsätter samma hämtning och Board visar sin vanliga väg:
  // laddning, sedan felvy (och dekoren ritas utan det som saknas).
  const failed = [usersQuery, ...(decorations ? [titlesQuery, rankDeltaQuery, groupBadgesQuery] : [])].some(hasFailed);
  const settled = arrived || failed;

  useEffect(() => {
    if (settled) onDone();
  }, [settled, onDone]);

  useEffect(() => {
    const timer = setTimeout(onDone, FIRST_BOARD_DATA_MAX_WAIT_MS);
    return () => clearTimeout(timer);
  }, [onDone]);

  return <RoutePending />;
}

/**
 * Första laddningen av /board (ADR 006, addendum 2026-10-19, punkt 11): appens laddningsvy står kvar tills allt som podiekorten ritas ur finns
 * (gruppen och, i Season-vyn, titlarna, rank-pilarna och badge-minis), så att ingen bildruta visar Board med tomma platser eller med "No titles held yet"
 * som fylls på. Skalet och sidan monteras först när gaten släppt, så vyn är samma bild på samma plats som i index.html. Gaten avgörs en gång, när den
 * monteras, och släpper bara en väg (också när användaren lämnar /board medan den håller): senare navigering, bakgrundsuppdateringar och andra sidor ser den aldrig. Misslyckas någon del eller drar kedjan över
 * taket släpps gaten, och Board visar sin egen laddning eller felvy.
 */
export function FirstBoardGate() {
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const onBoard = matchPath(paths.board, pathname) !== null;
  const [holding, setHolding] = useState(() => onBoard && queryClient.getQueryData(USERS_WITH_RUNS_QUERY_KEY) === undefined);
  const release = useCallback(() => setHolding(false), []);

  // Den som lämnar /board medan gaten håller (bakåtknappen till en annan sida) ska inte vänta på Boards data: gaten är över för gott.
  if (holding && !onBoard) setHolding(false);

  return holding ? <HoldUntilBoardData onDone={release} /> : <Outlet />;
}
