import { supabase } from '../config/database';
import { logger } from '../utils/logger.js';
import type { TitleContext } from '../titleEngines/types';

/**
 * Klockan som group-eligibility räknar med (RUN-141): tidpunkten för senaste titelomräkningen, så att "Best so far"
 * använder samma vinterfönster som de lagrade innehavarna (user_titles) i stället för request-tidens. Fönstret
 * byter nämligen först vid nästa omräkning efter 1 december (ingen cron), och lagrade värden byter då med det.
 *
 * Tidsstämpeln är max(titles.updated_at): update_title_leaderboard stämplar titeln varje gång dess topplista
 * byggs om, dvs. när någon användares titelvärde ändrats. Det är en nedre gräns för "senaste omräkningen" — en körning
 * utan ändringar syns inte. Saknas en giltig tidsstämpel, eller går läsningen fel, används request-tiden (förra
 * beteendet): eligibility är en bonus och får aldrig fälla svaret.
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
    logger.warn('⚠️ Could not read last title recalculation time; using request time:', error);
    return { now: requestTime };
  }
}
