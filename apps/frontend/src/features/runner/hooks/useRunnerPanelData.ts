import { useMemo } from 'react';
import type { User } from '@runquest/types';
import { useNow } from '@/app-shell/useNow';
import { buildRunnerBadges } from '@/features/badges/badgeModel';
import { useGroupBadges, useUserBadges } from '@/features/badges/hooks/useBadgeQueries';
import { useAuth } from '@/providers/authContext';
import { buildHero, buildStatCells } from '../runnerModel';
import { useHeadToHead, useRunnerTitles } from './useRunnerQueries';

/**
 * Datakopplingen bakom hjältekortet, BADGES-panelen och Head to head, på ETT ställe: sidan (`RunnerPanels`) och popupen (banner och flikar) ritar panelerna ur samma hämtade data,
 * bara placeringen skiljer.
 *
 * Löparens badges (spec F11): minis i hjältekortet och den kompakta, skrivskyddade BADGES-panelen. Badges är tillägg, inte kortets kärna: medan de laddas visar panelen
 * laddaren, och felar de ritas inga minis och panelen visar ett felkort med Retry (tomläget gäller bara ett lyckat, tomt svar). Gruppens holders ger held-by; felar den
 * utelämnas raden utan platshållare.
 *
 * Head to head: rekordet ur den inloggades sida. Frågan delas i cachen med Challenge-knappen i huvudytan; utan inloggad finns inget att jämföras med (`headToHead` är null).
 */
export function useRunnerPanelData(user: User, allUsers: User[]) {
  const { user: me } = useAuth();
  const now = useNow();
  const titlesQuery = useRunnerTitles(user.id);
  const userBadges = useUserBadges(user.id);
  const groupBadges = useGroupBadges(!!me);
  const headToHeadQuery = useHeadToHead(user.id);

  const hero = useMemo(() => buildHero(user, allUsers), [user, allUsers]);
  const heldTitles = titlesQuery.data ? titlesQuery.data.filter((title) => title.is_current_holder).length : null;
  const cells = useMemo(() => buildStatCells(user, heldTitles), [user, heldTitles]);
  const badges = useMemo(
    () => buildRunnerBadges(userBadges.data, groupBadges.data, { viewerId: me?.id ?? null, ownerId: user.id }),
    [userBadges.data, groupBadges.data, me?.id, user.id],
  );
  // Felkort med Retry bara när det inte finns något att visa: en misslyckad bakgrundsomhämtning låter den gamla samlingen stå kvar.
  const badgeError = userBadges.isError && !userBadges.data
    ? { retrying: userBadges.isFetching, onRetry: () => void userBadges.refetch() }
    : undefined;
  const headToHead = me
    ? {
        opponentName: user.name,
        meId: me.id,
        data: headToHeadQuery.data,
        isError: headToHeadQuery.isError,
        isFetching: headToHeadQuery.isFetching,
        onRetry: () => void headToHeadQuery.refetch(),
      }
    : null;

  return { now, hero, cells, showcase: badges.showcase, badgeRows: badges.rows, badgesLoading: userBadges.isLoading, badgeError, headToHead };
}

export type RunnerPanelData = ReturnType<typeof useRunnerPanelData>;
/** Det en Head to head-yta behöver: popupens panel i bannern och sidans kort ritar båda ur den här formen. */
export type HeadToHeadSource = NonNullable<RunnerPanelData['headToHead']>;
