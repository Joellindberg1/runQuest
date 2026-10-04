import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Run } from '@runquest/types';
import { backendApi } from '@/shared/services/backendApi';
import { USERS_WITH_RUNS_QUERY_KEY } from '@/shared/hooks/useUsersWithRuns';
import { titleQueryKeys } from '@/shared/hooks/useTitleQueries';
import { HEAD_TO_HEAD_ROOT } from '@/features/runner/hooks/useRunnerQueries';
import { EVENTS_QUERY_KEYS } from '@/features/events/hooks/useEventsQueries';
import type { RunSubmission } from '../logModel';
import { LOG_QUERY_KEYS } from './useLogQueries';

/** Roten för Boards queries (BOARD_QUERY_KEYS.week och .rankDelta ligger under den). */
const LEADERBOARD_ROOT = ['leaderboard'] as const;
/** Gruppens titelrader per användare (useMultipleUserTitles) ligger utanför ['titles']-roten. */
const MULTIPLE_USER_TITLES_ROOT = ['multiple-user-titles'] as const;

/**
 * POST /runs lägger även eventkvalificeringen i bakgrunden (backend väntar inte på den), så den första omhämtningen av
 * öppna event kan komma före den. Därför en andra efter en kort stund — "N of M done" ska inte vänta på nästa intervall.
 */
export const EVENT_FOLLOW_UP_MS = 4_000;

/**
 * Logga en runda. En lyckad runda ändrar allt som räknas ur rundorna: gruppens användare (streak, XP, nivå, km), Boards
 * leaderboard/vecka/rank-delta, öppna event, titlarna (`['titles']` samt `['multiple-user-titles']`), pågående utmaningars progress, Runner cards head-to-head och gruppens historik. Alla invalideras;
 * bara användarna väntas in (förhandsvisningen läser dem, så bekräftelsen och nästa förhandsvisning stämmer överens).
 * Meddelanden till användaren sköts av skärmen (Toaster är inte monterad i appen), därför kastar mutationen.
 */
export function useCreateRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (submission: RunSubmission): Promise<Run> => {
      const res = await backendApi.createRun(submission.date, submission.distance, 'manual', submission.isTreadmill);
      if (!res.success || !res.data) throw new Error(res.error || 'Failed to log the run');
      return res.data;
    },
    onSuccess: async () => {
      void queryClient.invalidateQueries({ queryKey: LEADERBOARD_ROOT });
      void queryClient.invalidateQueries({ queryKey: EVENTS_QUERY_KEYS.open, exact: true });
      void queryClient.invalidateQueries({ queryKey: titleQueryKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['challenges'] });
      void queryClient.invalidateQueries({ queryKey: HEAD_TO_HEAD_ROOT });
      void queryClient.invalidateQueries({ queryKey: MULTIPLE_USER_TITLES_ROOT });
      void queryClient.invalidateQueries({ queryKey: LOG_QUERY_KEYS.history });
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: EVENTS_QUERY_KEYS.open, exact: true }), EVENT_FOLLOW_UP_MS);
      await queryClient.invalidateQueries({ queryKey: USERS_WITH_RUNS_QUERY_KEY });
    },
  });
}
