import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateRunResponse } from '@runquest/shared';
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
    mutationFn: async (submission: RunSubmission): Promise<CreateRunResponse['run']> => {
      const res = await backendApi.createRun(submission.date, submission.distance, submission.isTreadmill, submission.idempotencyKey);
      if (!res.success || !res.data) throw runChangeError(res, 'Failed to log the run');
      return res.data;
    },
    onSuccess: () => invalidateAfterRunChange(queryClient),
    onError: invalidateIfRunWritten(queryClient),
  });
}
