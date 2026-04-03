// 📅 Event Scheduler
import { logger } from '../utils/logger.js';
import cron from 'node-cron';
import { tomorrowStockholm, addDaysToDate } from '../utils/dateUtils.js';
import {
  maybeCreateEvent,
  getAllGroupIds,
  settleCompetitionEvents,
  settleExpiredParticipationEvents,
  activateScheduledEvents,
  checkStormChaserForecast,
  getEventPool,
} from '../services/eventService.js';

const STOCKHOLM = 'Europe/Stockholm';

// ─── Timezone helper ──────────────────────────────────────────────────────────

/** Returnerar en Date för hour:minute Stockholm-tid på ett givet "YYYY-MM-DD" datum.
 *  Använder Intl.DateTimeFormat.formatToParts för att bestämma UTC-offset —
 *  korrekt oavsett serverns lokala tidszon och hanterar DST automatiskt. */
function atStockholm(dateStr: string, hour: number, minute: number = 0): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  // Sond mot kl 12:00 UTC samma dag för att hämta Stockholms faktiska offset (hanterar DST)
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: STOCKHOLM,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(probe);
  const stockholmNoon = Number(parts.find(p => p.type === 'hour')?.value ?? '12');
  const offsetHours = stockholmNoon - 12;
  return new Date(Date.UTC(y, m - 1, d, hour - offsetHours, minute, 0));
}

/** Skapar events för alla grupper för ett givet template och tidsfönster. */
async function createForAllGroups(
  templateName: string,
  startsAt: Date,
  endsAt: Date
): Promise<void> {
  const groups = await getAllGroupIds();
  if (!groups.length) return;
  await Promise.allSettled(
    groups.map(groupId => maybeCreateEvent(templateName, groupId, startsAt, endsAt))
  );
}

// ─── Daglig participation-lottning — Morgonrunda / Kvällsrunda / Storm Chaser ─

/**
 * Körs dagligen 19:00 Stockholm.
 *
 * Dessa tre events DELAR en lottning — de kan aldrig triggas samma dag.
 *
 * Steg 1 — gemensam tärning: summan av alla vikter avgör om NÅGOT händer alls.
 *   Utan storm: 10% + 10% = 20% chans att något triggas.
 *   Med storm:  10% + 10% + 30% = 50% chans.
 *
 * Steg 2 — viktad tärning: av de kandidater som finns väljs ETT event.
 *   Utan storm: 50/50 Morgonrunda vs Kvällsrunda.
 *   Med storm:  Storm Chaser 3x mer sannolikt än vardera tidsfönster-event.
 *
 * Vikter (spawn_chance) från ursprungsdesign:
 *   Morgonrunda  10%
 *   Kvällsrunda  10%
 *   Storm Chaser 30%  (ingår bara om väderprognosen kvalificerar)
 */
interface DailyDrawResult {
  fired: boolean;
  picked: string | null;
  stormQualifies: boolean;
  totalWeight: number;
  pool: Array<{ name: string; weight: number; sharePct: number }>;
}

async function runDailyParticipationDraw(): Promise<DailyDrawResult> {
  const tomorrow = tomorrowStockholm();

  const eventPool = await getEventPool('daily');
  if (!eventPool) {
    logger.error('❌ [EventScheduler] Daily pool not found in DB');
    return { fired: false, picked: null, stormQualifies: false, totalWeight: 0, pool: [] };
  }

  const stormQualifies = await checkStormChaserForecast();

  // Filter out weather-conditioned members unless storm qualifies
  const candidates = eventPool.members.filter(m => m.condition !== 'weather' || stormQualifies);
  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  const pool = candidates.map(c => ({
    name: c.name,
    weight: c.weight,
    sharePct: totalWeight > 0 ? Math.round((c.weight / totalWeight) * 100) : 0,
  }));

  // Steg 1: pool trigger chance gate — händer något alls?
  if (Math.random() >= eventPool.triggerChance) {
    logger.info(`📅 [EventScheduler] Daily roll: no event for ${tomorrow} (trigger chance ${(eventPool.triggerChance * 100).toFixed(0)}%)`);
    return { fired: false, picked: null, stormQualifies, totalWeight, pool };
  }

  if (!candidates.length) {
    logger.info(`📅 [EventScheduler] Daily roll: pool triggered but no eligible candidates`);
    return { fired: false, picked: null, stormQualifies, totalWeight: 0, pool: [] };
  }

  // Steg 2: viktad tärning — välj ETT event från poolen
  let rand = Math.random() * totalWeight;
  let picked = candidates[candidates.length - 1];
  for (const c of candidates) {
    rand -= c.weight;
    if (rand <= 0) { picked = c; break; }
  }

  const startsAt = atStockholm(tomorrow, picked.startHour, 0);
  const endDate  = picked.endDayOffset > 0 ? addDaysToDate(tomorrow, picked.endDayOffset) : tomorrow;
  const endsAt   = atStockholm(endDate, picked.endHour, picked.endMinute);

  logger.info(`📅 [EventScheduler] Daily roll: "${picked.name}" selected for ${tomorrow} (weight ${picked.weight} / total ${totalWeight.toFixed(2)})`);
  await createForAllGroups(picked.name, startsAt, endsAt);

  return { fired: true, picked: picked.name, stormQualifies, totalWeight, pool };
}

async function scheduleDailyParticipationEvent(): Promise<void> {
  await runDailyParticipationDraw();
}

/** Exponerad för admin-endpoint — kör draget och returnerar resultat. */
export async function scheduleDailyParticipationEventTest(): Promise<DailyDrawResult> {
  return runDailyParticipationDraw();
}

// ─── Helg-event ───────────────────────────────────────────────────────────────

/**
 * Körs Fredag + Lördag 22:00 Stockholm.
 * Hangover Run: hela nästkommande dag 00:00–23:59.
 * Spawn chance: 20% — triggar bara en av fem helgkvällar.
 */
async function scheduleHangoverRun(): Promise<void> {
  const pool = await getEventPool('weekend');
  if (!pool || !pool.members.length) {
    logger.error('❌ [EventScheduler] Weekend pool not found or empty');
    return;
  }

  if (Math.random() >= pool.triggerChance) {
    logger.info(`📅 [EventScheduler] Hangover Run roll miss (${(pool.triggerChance * 100).toFixed(0)}% trigger chance)`);
    return;
  }

  const picked = pool.members[0];
  const tomorrow = tomorrowStockholm();
  const startsAt = atStockholm(tomorrow, picked.startHour, 0);
  const endDate  = picked.endDayOffset > 0 ? addDaysToDate(tomorrow, picked.endDayOffset) : tomorrow;
  const endsAt   = atStockholm(endDate, picked.endHour, picked.endMinute);

  logger.info(`📅 [EventScheduler] Hangover Run triggered for ${tomorrow}`);
  await createForAllGroups(picked.name, startsAt, endsAt);
}

// ─── Torsdags-event — 5K Friday ───────────────────────────────────────────────

/**
 * Körs Torsdag 18:00 Stockholm.
 * 5K Friday: fredag 00:00–23:59.
 * Spawn chance: 30% — triggar ungefär var tredje vecka.
 */
async function scheduleFridayEvent(): Promise<void> {
  const pool = await getEventPool('thursday');
  if (!pool || !pool.members.length) {
    logger.error('❌ [EventScheduler] Thursday pool not found or empty');
    return;
  }

  // Steg 1: pool trigger chance gate — händer något alls?
  if (Math.random() >= pool.triggerChance) {
    logger.info(`📅 [EventScheduler] Thursday roll miss (${(pool.triggerChance * 100).toFixed(0)}% trigger chance)`);
    return;
  }

  // Steg 2: viktad tärning — välj ETT event
  const totalWeight = pool.members.reduce((s, c) => s + c.weight, 0);
  let rand = Math.random() * totalWeight;
  let picked = pool.members[pool.members.length - 1];
  for (const c of pool.members) { rand -= c.weight; if (rand <= 0) { picked = c; break; } }

  const tomorrow = tomorrowStockholm(); // torsdag kväll → imorgon = fredag
  const startsAt = atStockholm(tomorrow, picked.startHour, 0);
  const endDate  = picked.endDayOffset > 0 ? addDaysToDate(tomorrow, picked.endDayOffset) : tomorrow;
  const endsAt   = atStockholm(endDate, picked.endHour, picked.endMinute);

  logger.info(`📅 [EventScheduler] Thursday roll: "${picked.name}" selected for ${tomorrow} (ends ${endDate})`);
  await createForAllGroups(picked.name, startsAt, endsAt);
}

// ─── Lördag — Weekly competition events ──────────────────────────────────────

/**
 * Körs Lördag 20:00 Stockholm — skapar Weekly km + Weekly höjdmeter för nästa vecka.
 * Tävlingarna startar Måndag 00:01 och slutar Söndag 23:59.
 * Alltid deterministisk — ingen spawn chance.
 */
async function scheduleWeeklyCompetitions(): Promise<void> {
  const today   = new Intl.DateTimeFormat('sv-SE', { timeZone: STOCKHOLM }).format(new Date());
  const monday  = addDaysToDate(today, 2);
  const sunday  = addDaysToDate(today, 8);
  const startsAt = atStockholm(monday, 0, 1);
  const endsAt   = atStockholm(sunday, 23, 59);

  logger.info(`📅 [EventScheduler] Weekly competitions: ${monday} 00:01 → ${sunday} 23:59`);
  await Promise.allSettled([
    createForAllGroups('Weekly km', startsAt, endsAt),
    createForAllGroups('Weekly höjdmeter', startsAt, endsAt),
  ]);
}

// ─── Scheduler entry point ───────────────────────────────────────────────────

export function startEventScheduler(): void {
  logger.info('📅 Starting event scheduler...');

  // Dagligen 19:00 Stockholm ≈ 17:00 UTC
  // Gemensam + viktad lottning: Morgonrunda / Kvällsrunda / Storm Chaser — max ett event
  cron.schedule('0 17 * * *', async () => {
    logger.info('⏰ [EventScheduler] Daily participation draw...');
    try {
      await scheduleDailyParticipationEvent();
    } catch (e) {
      logger.error('❌ [EventScheduler] Daily participation draw error:', e);
    }
  });

  // Fredag + Lördag 22:00 Stockholm ≈ 20:00 UTC — Hangover Run (20% spawn chance)
  cron.schedule('0 20 * * 5,6', async () => {
    logger.info('⏰ [EventScheduler] Weekend Hangover Run draw...');
    try {
      await scheduleHangoverRun();
    } catch (e) {
      logger.error('❌ [EventScheduler] Hangover Run draw error:', e);
    }
  });

  // Torsdag 18:00 Stockholm ≈ 16:00 UTC — 5K Friday (30% spawn chance)
  cron.schedule('0 16 * * 4', async () => {
    logger.info('⏰ [EventScheduler] Thursday 5K Friday draw...');
    try {
      await scheduleFridayEvent();
    } catch (e) {
      logger.error('❌ [EventScheduler] 5K Friday draw error:', e);
    }
  });

  // Lördag 20:00 Stockholm ≈ 18:00 UTC — Weekly km + Weekly höjdmeter (deterministisk)
  cron.schedule('0 18 * * 6', async () => {
    logger.info('⏰ [EventScheduler] Saturday — scheduling weekly competitions...');
    try {
      await scheduleWeeklyCompetitions();
    } catch (e) {
      logger.error('❌ [EventScheduler] Weekly competition error:', e);
    }
  });

  // Söndag 23:55 Stockholm ≈ 21:55 UTC — settlement av competition-events
  cron.schedule('55 21 * * 0', async () => {
    logger.info('⏰ [EventScheduler] Sunday settlement...');
    try {
      await settleCompetitionEvents();
    } catch (e) {
      logger.error('❌ [EventScheduler] Competition settlement error:', e);
    }
  });

  // Var 5:e minut — aktiverar schemalagda events + settlar utgångna
  cron.schedule('*/5 * * * *', async () => {
    try {
      await activateScheduledEvents();
      await settleExpiredParticipationEvents();
    } catch (e) {
      logger.error('❌ [EventScheduler] Lifecycle tick error:', e);
    }
  });

  logger.info('✅ Event scheduler started');
}
