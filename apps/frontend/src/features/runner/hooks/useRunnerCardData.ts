import { useMemo } from 'react';
import type { User } from '@runquest/types';
import { useNow } from '@/app-shell/useNow';
import { buildRunnerBadges } from '@/features/badges/badgeModel';
import { useGroupBadges, useUserBadges } from '@/features/badges/hooks/useBadgeQueries';
import { useAuth } from '@/providers/authContext';
import { buildHero, buildStatCells } from '../runnerModel';
import { useHeadToHead, useRunnerTitles } from './useRunnerQueries';

/**
 * Datakopplingen som sidan (`RunnerCard`) och popupen (`RunnerPopup`) delar: samma frågor, samma vymodeller. Bara ramen och placeringen skiljer
 * (ADR 006 addendum 2026-10-26, beslut 1 och 4), så hämtningen bor på ETT ställe.
 *
 * Badges är tillägg, inte kortets kärna: laddar de visar panelen laddaren, och felar de ritas inga minis och panelen får ett felkort med Retry
 * (`badgeError`); tomläget gäller bara ett lyckat, tomt svar. Gruppens holders ger held-by; felar den utelämnas raden utan platshållare.
 */
export function useRunnerCardData(user: User, allUsers: User[]) {
  const { user: me } = useAuth();
  const now = useNow();
  const titlesQuery = useRunnerTitles(user.id);
  const headToHead = useHeadToHead(user.id);
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

  return { me, now, headToHead, hero, cells, badges, badgeLoading: userBadges.isLoading, badgeError };
}

export type RunnerCardData = ReturnType<typeof useRunnerCardData>;
