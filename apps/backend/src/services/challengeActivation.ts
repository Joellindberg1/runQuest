import { challengeWindow } from '@runquest/shared';
import type { getSupabaseClient } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { errorCode } from '../utils/errorCode.js';

export interface ChallengeToActivate {
  id: string;
  challenger_id: string;
  opponent_id: string;
  duration_days: number;
}

export type ActivationResult =
  /** Utmaningen är aktiv och båda parterna är upptagna. */
  | { outcome: 'activated'; endDate: string }
  /** Ingen pending-rad att aktivera (en accept, decline eller tidigare körning hann före). Inget har skrivits. */
  | { outcome: 'not_pending' }
  /** En skrivning misslyckades; utmaningen är pending igen (eller aldrig aktiverad). Anroparen loggar `error` en gång, med sin kod. */
  | { outcome: 'failed'; stage: 'activate' | 'flag'; error: unknown };

/**
 * Aktiverar en väntande utmaning: en accept och legendary-autostarten gör exakt detta. Utmaningen aktiveras först, spelarnas
 * challenge_active efteråt. Misslyckas flaggan släpps aktiveringen (tillbaka till pending), så utmaningen aldrig lämnas aktiv
 * medan spelarna inte räknas som upptagna.
 * Villkorad på status = pending + radräkning: raderar en decline/withdraw/auto-decline utmaningen, eller en annan väg aktiverar
 * den, mellan läsningen och denna skrivning träffar updaten 0 rader utan fel — då sätts inga flaggor.
 */
export async function activatePendingChallenge(
  supabase: ReturnType<typeof getSupabaseClient>,
  challenge: ChallengeToActivate,
  startDate: string,
): Promise<ActivationResult> {
  const { endDate, determineAt } = challengeWindow(startDate, challenge.duration_days);

  const { data: activated, error: activateError } = await supabase
    .from('challenges')
    .update({ status: 'active', start_date: startDate, end_date: endDate, determine_at: determineAt.toISOString() })
    .eq('id', challenge.id)
    .eq('status', 'pending')
    .select('id');
  if (activateError) return { outcome: 'failed', stage: 'activate', error: activateError };
  // supabase-js ger alltid en array efter .select() utan fel; en tom array = ingen rad aktiverades.
  if (Array.isArray(activated) && activated.length === 0) return { outcome: 'not_pending' };

  const { error: flagError } = await supabase
    .from('users')
    .update({ challenge_active: true })
    .in('id', [challenge.challenger_id, challenge.opponent_id]);
  if (flagError) {
    const { error: revertError } = await supabase
      .from('challenges')
      .update({ status: 'pending', start_date: null, end_date: null, determine_at: null })
      .eq('id', challenge.id);
    if (revertError) logger.error(`❌ Could not revert activation of challenge ${challenge.id} (${errorCode(revertError)})`);
    return { outcome: 'failed', stage: 'flag', error: flagError };
  }

  return { outcome: 'activated', endDate };
}
