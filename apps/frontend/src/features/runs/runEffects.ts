import type { QueryClient } from '@tanstack/react-query';
import { EVENTS_QUERY_KEYS } from '@/features/events/hooks/useEventsQueries';
import { NEWS_QUERY_KEYS } from '@/features/news/hooks/useNewsQueries';
import { LOG_QUERY_KEYS } from '@/features/log/hooks/useLogQueries';
import { HEAD_TO_HEAD_ROOT } from '@/features/runner/hooks/useRunnerQueries';
import { titleQueryKeys } from '@/shared/hooks/useTitleQueries';
import { USERS_WITH_RUNS_QUERY_KEY } from '@/shared/hooks/useUsersWithRuns';

/** Roten för Boards queries (BOARD_QUERY_KEYS.week och .rankDelta ligger under den). */
const LEADERBOARD_ROOT = ['leaderboard'] as const;
/** Gruppens titelrader per användare (useMultipleUserTitles) ligger utanför ['titles']-roten. */
const MULTIPLE_USER_TITLES_ROOT = ['multiple-user-titles'] as const;

/**
 * Servern kvalificerar event i bakgrunden efter en ändring av rundorna (fire-and-forget), så den första omhämtningen av
 * öppna event kan komma före den. Därför en andra efter en kort stund — "N of M done" ska inte vänta på nästa intervall.
 */
export const EVENT_FOLLOW_UP_MS = 4_000;

/**
 * Allt som räknas ur rundorna när en runda läggs till, ändras eller raderas: gruppens användare (streak, XP, nivå, km, hela
 * rundlistan), Boards leaderboard/vecka/rank-delta, öppna event, titlarna (`['titles']` samt `['multiple-user-titles']`),
 * pågående utmaningars progress, Runner cards head-to-head, gruppens historik och Pack News. Alla invalideras; bara användarna väntas in
 * (skärmarna läser dem, så bekräftelsen och nästa rendering stämmer överens). EN kedja för POST (Log) och PUT/DELETE (Profile).
 */
export async function invalidateAfterRunChange(queryClient: QueryClient): Promise<void> {
  void queryClient.invalidateQueries({ queryKey: LEADERBOARD_ROOT });
  void queryClient.invalidateQueries({ queryKey: EVENTS_QUERY_KEYS.open, exact: true });
  void queryClient.invalidateQueries({ queryKey: titleQueryKeys.all });
  void queryClient.invalidateQueries({ queryKey: ['challenges'] });
  void queryClient.invalidateQueries({ queryKey: HEAD_TO_HEAD_ROOT });
  void queryClient.invalidateQueries({ queryKey: MULTIPLE_USER_TITLES_ROOT });
  void queryClient.invalidateQueries({ queryKey: LOG_QUERY_KEYS.history });
  // Klockan och Pack News: en egen runda kan ge level up/milstolpe/titelbyte — räknaren ska inte vänta på nästa poll.
  void queryClient.invalidateQueries({ queryKey: NEWS_QUERY_KEYS.feedRoot });
  setTimeout(() => void queryClient.invalidateQueries({ queryKey: EVENTS_QUERY_KEYS.open, exact: true }), EVENT_FOLLOW_UP_MS);
  await queryClient.invalidateQueries({ queryKey: USERS_WITH_RUNS_QUERY_KEY });
}
