import { useMutation, useQueryClient } from '@tanstack/react-query';
import { track } from '@/shared/analytics/track';
import { backendApi } from '@/shared/services/backendApi';
import { USERS_WITH_RUNS_QUERY_KEY } from '@/shared/hooks/useUsersWithRuns';
import { HEAD_TO_HEAD_ROOT } from '@/features/runner/hooks/useRunnerQueries';
import { NEWS_QUERY_KEYS } from '@/features/news/hooks/useNewsQueries';


type ApiResult = { success: boolean; error?: string; reason?: 'timeout' | 'network' };

/** Sägs när skicket inte fick något svar inom tidsgränsen: vi vet inte om utmaningen gick iväg, så vi påstår varken det ena eller det andra. */
const SEND_UNCONFIRMED_TEXT = "We couldn't confirm that your challenge was sent. Check your sent challenges before you try again.";
/** Sägs när skicket inte nådde servern (bruten anslutning), i stället för webbläsarens "Failed to fetch". */
const SEND_UNREACHABLE_TEXT = "Couldn't reach RunQuest. Check your connection and try again.";

/** Skicket fick inget svar i tid. Skilt från andra fel för att utmaningen kan ha skapats: då ska listorna hämtas om. */
class SendUnconfirmedError extends Error {}

/** Backendens fel (`{ success: false, error }`) blir ett kastat Error, så att mutationen får `isError` och ett meddelande. */
async function unwrap<T extends ApiResult>(call: Promise<T>, fallback: string): Promise<T> {
  const res = await call;
  if (!res.success) throw new Error(res.error || fallback);
  return res;
}

/** Som `unwrap`, men ett skick utan svar eller utan anslutning får en text som säger det ärligt. Serverns egna felmeddelanden visas som förut. */
async function unwrapSend<T extends ApiResult>(call: Promise<T>): Promise<T> {
  const res = await call;
  if (res.success) return res;
  if (res.reason === 'timeout') throw new SendUnconfirmedError(SEND_UNCONFIRMED_TEXT);
  if (res.reason === 'network') throw new Error(SEND_UNREACHABLE_TEXT);
  throw new Error(res.error || 'Failed to send challenge');
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
      // Utmaning skickad/avböjd/återkallad ger (eller tar bort) en rad i Pack News — klockan uppdateras direkt.
      queryClient.invalidateQueries({ queryKey: NEWS_QUERY_KEYS.feedRoot }),
    ]);
  };

  const send = useMutation({
    mutationFn: ({ tokenId, opponentId }: { tokenId: string; opponentId: string }) => unwrapSend(backendApi.sendChallenge(tokenId, opponentId)),
    onSuccess: refresh,
    // Utmaningen kan ha skapats trots att svaret uteblev: listorna hämtas om så att den syns. Inte `return`: avslaget ska nå arket nu, inte efter omhämtningen (som själv kan hänga).
    onError: (error) => {
      if (error instanceof SendUnconfirmedError) void refresh();
    },
  });

  const accept = useMutation({
    mutationFn: (challengeId: string) => unwrap(backendApi.respondToChallenge(challengeId, 'accept'), 'Failed to accept challenge'),
    onSuccess: () => {
      track('challenge-accepted');
      return refresh();
    },
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
