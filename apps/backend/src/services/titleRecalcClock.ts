import { supabase } from '../config/database.js';
import { logger } from '../utils/logger.js';
import type { TitleContext } from '../titleEngines/types';
import { errorCode, errorWithCode } from '../utils/errorCode.js';

/**
 * Klockan som group-eligibility räknar med (RUN-141): tidpunkten för gruppens senaste titelomräkning, så att "Best so far"
 * använder samma vinterfönster som de lagrade innehavarna (user_titles) i stället för request-tidens. Fönstret
 * byter nämligen först vid nästa omräkning efter 1 december (ingen cron), och lagrade värden byter då med det.
 *
 * Klockan är GRUPPENS (ADR 012 beslut 5.6): max(title_leaderboard.updated_at) för gruppen. Raderna skrivs om av
 * update_group_title_leaderboard (DELETE + INSERT, så updated_at får kolumnens default now()) varje gång gruppens topplista för en titel
 * byggs om, och processGroupTitles kör alltid update_group_title_leaderboards efter gruppens titelomräkning (varje anropare: rundloggning,
 * nattens synk, reprocess-all), så varje omräkning stämplar gruppens alla topplistor med innehavare. En annan grupps omräkning rör inte
 * gruppens rader. titles.updated_at stämplas inte längre (migration 058) och duger inte som källa. Saknas en giltig tidsstämpel (gruppen har ingen
 * innehavare i någon titel, alltså inga lagrade värden att stämma av mot), eller går läsningen fel, används request-tiden (förra beteendet):
 * eligibility är en bonus och får aldrig fälla svaret. Klockan klampas till högst request-tiden.
 *
 * Fail-closed (ADR 007 A6): utan groupId kastas det innan något läses. Det finns ingen global klocka att falla tillbaka på.
 *
 * Kända glapp (klockan är en approximation, inte en exakt omräkningstid):
 * - Midnattsglipan: en omräkning som korsar Stockholmsmidnatt (30 nov -> 1 dec) använder ett "nu" från körningens
 *   start (ctx delas av alla användare), medan title_leaderboard.updated_at stämplas när respektive topplista byggs, kanske efter
 *   midnatt. Klockan kan då visa den nya vintern fast de lagrade värdena räknades med den förra.
 * - Partiell omräkning: en gruppkörning med failed > 0 lämnar
 *   en del lagrade värden räknade med äldre fönster, trots att topplistorna ändå stämplas.
 * - Andra ombyggnader av gruppens topplista (manuell populate/refresh, ombyggnad efter join, admin-SQL, migrationer) flyttar klockan utan
 *   att några användare räknats om.
 */
export async function getTitleRecalcContext(groupId: string): Promise<TitleContext> {
  if (typeof groupId !== 'string' || groupId === '') throw new Error('getTitleRecalcContext kräver groupId');
  const requestTime = new Date();
  try {
    // Utan NULL-raderna: Postgres sorterar NULL först vid desc, och kolumnen är nullbar.
    const { data, error } = await supabase.client
      .from('title_leaderboard')
      .select('updated_at')
      .eq('group_id', groupId)
      .not('updated_at', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (error) throw errorWithCode('Failed to read the last title recalculation time', error);

    const latest = data?.[0]?.updated_at;
    const parsed = latest ? new Date(latest) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) return { now: requestTime };
    // Aldrig framåt i tiden: en klocka före request-tiden är poängen, en efter den vore ett fel i data.
    return { now: parsed < requestTime ? parsed : requestTime };
  } catch (error) {
    logger.warn(`⚠️ Could not read last title recalculation time; using request time (${errorCode(error)})`);
    return { now: requestTime };
  }
}
