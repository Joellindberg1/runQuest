import { useMutation, useQueryClient } from '@tanstack/react-query';
import { backendApi } from '@/shared/services/backendApi';
import { USERS_WITH_RUNS_QUERY_KEY } from '@/shared/hooks/useUsersWithRuns';
import { HEAD_TO_HEAD_ROOT } from '@/features/runner/hooks/useRunnerQueries';


type ApiResult = { success: boolean; error?: string };

/** Backendens fel (`{ success: false, error }`) blir ett kastat Error, så att mutationen får `isError` och ett meddelande. */
async function unwrap<T extends ApiResult>(call: Promise<T>, fallback: string): Promise<T> {
  const res = await call;
  if (!res.success) throw new Error(res.error || fallback);
  return res;
}

/**
 * Skicka, svara på och dra tillbaka utmaningar. Alla fyra ändrar något som flera vyer läser: utmaningarna (inkl. skalets
 * "Right now"), gruppens tokens/W-D-L i users-with-runs och Runner cards head-to-head ("Challenge live").
 * Meddelanden till användaren sköts av skärmen (permanenta statusregioner i stället för toast: samma mönster på alla skärmar, och texten finns kvar och läses upp pålitligt), därför kastar mutationerna.
 */
export function useChallengeActions() {
  const queryClient = useQueryClient();

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['challenges'] }),
      queryClient.invalidateQueries({ queryKey: USERS_WITH_RUNS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: HEAD_TO_HEAD_ROOT }),
    ]);
  };

  const send = useMutation({
    mutationFn: ({ tokenId, opponentId }: { tokenId: string; opponentId: string }) =>
      unwrap(backendApi.sendChallenge(tokenId, opponentId), 'Failed to send challenge'),
    onSuccess: refresh,
  });

  const accept = useMutation({
    mutationFn: (challengeId: string) => unwrap(backendApi.respondToChallenge(challengeId, 'accept'), 'Failed to accept challenge'),
    onSuccess: refresh,
  });

  const decline = useMutation({
    mutationFn: (challengeId: string) => unwrap(backendApi.respondToChallenge(challengeId, 'decline'), 'Failed to decline challenge'),
    onSuccess: refresh,
  });

  const withdraw = useMutation({
    mutationFn: (challengeId: string) => unwrap(backendApi.withdrawChallenge(challengeId), 'Failed to withdraw challenge'),
    onSuccess: refresh,
  });

  return { send, accept, decline, withdraw };
}
