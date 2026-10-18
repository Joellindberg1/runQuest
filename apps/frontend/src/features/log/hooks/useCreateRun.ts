import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Run } from '@runquest/types';
import { track } from '@/shared/analytics/track';
import { backendApi } from '@/shared/services/backendApi';
import { invalidateAfterRunChange, invalidateIfRunWritten, runChangeError } from '@/features/runs/runEffects';
import type { RunSubmission } from '../logModel';

export { EVENT_FOLLOW_UP_MS } from '@/features/runs/runEffects';

/**
 * Logga en runda. En lyckad runda ändrar allt som räknas ur rundorna — kedjan av invalideringar bor i `features/runs/runEffects`
 * och delas med Profiles redigera/radera, så att POST, PUT och DELETE aldrig glider isär.
 * Meddelanden till användaren sköts av skärmen (permanenta statusregioner i stället för toast: samma mönster på alla skärmar, och texten finns kvar och läses upp pålitligt), därför kastar mutationen.
 */
export function useCreateRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (submission: RunSubmission): Promise<Run> => {
      const res = await backendApi.createRun(submission.date, submission.distance, submission.isTreadmill, submission.idempotencyKey);
      if (!res.success || !res.data) throw runChangeError(res, 'Failed to log the run');
      return res.data;
    },
    onSuccess: () => {
      // Bara att en runda loggades för hand: ingen distans, inget datum, inget runda-id (Stravas API-policy 5.4). Importerade Stravarundor räknas inte här.
      track('run-logged-manual');
      return invalidateAfterRunChange(queryClient);
    },
    onError: invalidateIfRunWritten(queryClient),
  });
}
