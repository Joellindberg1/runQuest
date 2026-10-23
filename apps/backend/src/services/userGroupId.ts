// Användarens grupp läst färskt ur users.group_id: den enda läsningen av pekaren i services/ (ADR 012, anteckningen "Var gruppen kommer ifrån").
// Routes läser gruppen ur token via utils/groupScope.ts; tjänster som saknar request (Strava-import, nattjobb, händelseloggen) läser den här.
//
// Fail-closed: ett läsfel är aldrig "ingen grupp" som öppnar data. Vad ett fel betyder bestämmer anroparen i `onError`, och den får bara
// kasta (avbryta) eller återvända. Återvänder den är svaret null, och null betyder för varje anropare "inget läses och inget skrivs för en grupp".
// Ett gruppid kan alltså aldrig komma ur ett misslyckat anrop, vad `onError` än returnerar.
import { getSupabaseClient } from '../config/database.js';
import { errorWithCode } from '../utils/errorCode.js';

/** Felet `onError` får: en fast text och databasens kod (aldrig databasens egen text, som kan citera radvärden). `user_not_found` när raden saknas. */
export type GroupIdReadError = Error & { code: string };

export interface ReadUserGroupIdOptions {
  /**
   * Körs när gruppen inte kunde läsas (databasfel, eller en användare som inte finns). Kasta för att avbryta kedjan, eller logga och
   * återvänd för att avstå: då blir svaret null. Returvärdet används aldrig.
   */
  onError: (error: GroupIdReadError) => void;
}

/**
 * Gruppen `userId` pekar på, eller null om hen saknar en. Vid läsfel anropas `onError`; om den återvänder är svaret null.
 * Kastar bara det `onError` kastar.
 */
export async function readUserGroupId(userId: string, { onError }: ReadUserGroupIdOptions): Promise<string | null> {
  const { data, error } = await getSupabaseClient().from('users').select('group_id').eq('id', userId).maybeSingle();
  if (error || !data) {
    onError(errorWithCode('Could not read the group of the user', error ?? { code: 'user_not_found' }));
    return null;
  }
  return data.group_id ?? null;
}
