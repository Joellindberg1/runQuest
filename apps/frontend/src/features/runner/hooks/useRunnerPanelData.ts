import { useMemo } from 'react';
import type { User } from '@runquest/types';
import { useNow } from '@/app-shell/useNow';
import { buildRunnerBadges } from '@/features/badges/badgeModel';
import { useGroupBadges, useUserBadges } from '@/features/badges/hooks/useBadgeQueries';
import { useAuth } from '@/providers/authContext';
import { buildHero, buildStatCells } from '../runnerModel';
import { useRunnerTitles } from './useRunnerQueries';

/**
 * Datakopplingen bakom hjältekortet och BADGES-panelen, på ETT ställe: sidan (`RunnerPanels`) och popupen (flikarna) ritar panelerna ur samma hämtade data, bara placeringen skiljer.
 *
 * Löparens badges (spec F11): minis i hjältekortet och den kompakta, skrivskyddade BADGES-panelen. Badges är tillägg, inte kortets kärna: medan de laddas visar panelen
 * laddaren, och felar de ritas inga minis och panelen visar ett felkort med Retry (tomläget gäller bara ett lyckat, tomt svar). Gruppens holders ger held-by; felar den
 * utelämnas raden utan platshållare.
 */
export function useRunnerPanelData(user: User, allUsers: User[]) {
  const { user: me } = useAuth();
  const now = useNow();
  const titlesQuery = useRunnerTitles(user.id);
  const userBadges = useUserBadges(user.id);
  const groupBadges = useGroupBadges(!!me);

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

  return { now, hero, cells, showcase: badges.showcase, badgeRows: badges.rows, badgesLoading: userBadges.isLoading, badgeError };
}

export type RunnerPanelData = ReturnType<typeof useRunnerPanelData>;
