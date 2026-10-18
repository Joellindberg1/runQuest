import { supabase } from '../config/database';
import { logger } from '../utils/logger.js';
import type { TitleContext } from '../titleEngines/types';
import { errorCode } from '../utils/errorCode.js';

/**
 * Klockan som group-eligibility räknar med (RUN-141): tidpunkten för senaste titelomräkningen, så att "Best so far"
 * använder samma vinterfönster som de lagrade innehavarna (user_titles) i stället för request-tidens. Fönstret
 * byter nämligen först vid nästa omräkning efter 1 december (ingen cron), och lagrade värden byter då med det.
 *
 * Tidsstämpeln är max(titles.updated_at): update_title_leaderboard stämplar titeln varje gång dess topplista
 * byggs om, och calculateUserTotals kör alltid update_all_title_leaderboards efter titelomräkningen, så varje
 * omräkning stämplar alla titlar — även en där inga värden ändrades. Saknas en giltig tidsstämpel, eller går
 * läsningen fel, används request-tiden (förra beteendet): eligibility är en bonus och får aldrig fälla svaret.
 * Klockan klampas till högst request-tiden.
 *
 * Kända glapp (klockan är en approximation, inte en exakt omräkningstid):
 * - Midnattsglipan: en omräkning som korsar Stockholmsmidnatt (30 nov -> 1 dec) använder ett "nu" från körningens
 *   start (ctx delas av alla användare), medan titles.updated_at stämplas när respektive topplista byggs, kanske efter
 *   midnatt. Klockan kan då visa den nya vintern fast de lagrade värdena räknades med den förra.
 * - Partiell omräkning: en användare utan grupp får bara sin egen omräkning, och en gruppkörning med failed > 0 lämnar
 *   en del lagrade värden räknade med äldre fönster, trots att topplistorna ändå stämplas.
 * - Andra skrivningar av titles.updated_at (manuell populate/refresh, admin-SQL, migrationer) flyttar klockan utan
 *   att några användare räknats om.
 *
 * Flera grupper (antagande, att se över inför RUN-95): klockan är GLOBAL (max över alla titlar) och topplistan är
 * global, men omräkningen är gruppavgränsad (processAllUsersTitles(groupId)). En grupps omräkning kan alltså flytta
 * klockan för en annan grupp vars användare ännu inte räknats om med det nya fönstret.
 */
export async function getTitleRecalcContext(): Promise<TitleContext> {
  const requestTime = new Date();
  try {
    const { data, error } = await supabase.client
      .from('titles')
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1);

    if (error) throw new Error(error.message);

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
