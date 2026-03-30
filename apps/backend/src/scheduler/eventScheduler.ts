// 📅 Event Scheduler
import { logger } from '../utils/logger.js';
import cron from 'node-cron';
import { tomorrowStockholm, addDaysToDate } from '../utils/dateUtils.js';
import {
  maybeCreateEvent,
  getAllGroupIds,
  settleCompetitionEvents,
  settleExpiredParticipationEvents,
  checkStormChaserForecast,
} from '../services/eventService.js';

const STOCKHOLM = 'Europe/Stockholm';

// ─── Timezone helper ──────────────────────────────────────────────────────────

/** Returnerar en Date för hour:minute Stockholm-tid på ett givet "YYYY-MM-DD" datum. */
function atStockholm(dateStr: string, hour: number, minute: number = 0): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const noonUTC = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const noonStockholm = new Date(noonUTC.toLocaleString('en-US', { timeZone: STOCKHOLM }));
  const offsetHours = Math.round((noonStockholm.getTime() - noonUTC.getTime()) / 3_600_000);
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

  // Bygg kandidatpool
  const candidates: Array<{
    name: string;
    weight: number;
    startHour: number;
    endHour: number;
    endMinute: number;
  }> = [
    { name: 'Morgonrunda', weight: 0.10, startHour: 6,  endHour: 10, endMinute: 0 },
    { name: 'Kvällsrunda', weight: 0.10, startHour: 18, endHour: 22, endMinute: 0 },
  ];

  const stormQualifies = await checkStormChaserForecast();
  if (stormQualifies) {
    candidates.push({ name: 'Storm Chaser', weight: 0.30, startHour: 0, endHour: 23, endMinute: 59 });
  }

  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  const pool = candidates.map(c => ({
    name: c.name,
    weight: c.weight,
    sharePct: Math.round((c.weight / totalWeight) * 100),
  }));

  // Steg 1: gemensam tärning — händer något alls?
  if (Math.random() >= totalWeight) {
    logger.info(`📅 [EventScheduler] Daily roll: no event for ${tomorrow} (combined weight ${(totalWeight * 100).toFixed(0)}%)`);
    return { fired: false, picked: null, stormQualifies, totalWeight, pool };
  }

  // Steg 2: viktad tärning — välj ETT event från poolen
  let rand = Math.random() * totalWeight;
  let picked = candidates[candidates.length - 1];
  for (const c of candidates) {
    rand -= c.weight;
    if (rand <= 0) { picked = c; break; }
  }

  const startsAt = atStockholm(tomorrow, picked.startHour, 0);
  const endsAt   = atStockholm(tomorrow, picked.endHour,   picked.endMinute);

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
  const SPAWN_CHANCE = 0.20;
  if (Math.random() >= SPAWN_CHANCE) {
    logger.info('📅 [EventScheduler] Hangover Run roll miss (20% chance)');
    return;
  }

  const tomorrow = tomorrowStockholm();
  const startsAt = atStockholm(tomorrow, 0, 0);
  const endsAt   = atStockholm(tomorrow, 23, 59);

  logger.info(`📅 [EventScheduler] Hangover Run triggered for ${tomorrow}`);
  await createForAllGroups('Hangover Run', startsAt, endsAt);
}

// ─── Torsdags-event — 5K Friday ───────────────────────────────────────────────

/**
 * Körs Torsdag 18:00 Stockholm.
 * 5K Friday: fredag 00:00–23:59.
 * Spawn chance: 30% — triggar ungefär var tredje vecka.
 */
async function scheduleFridayEvent(): Promise<void> {
  const SPAWN_CHANCE = 0.30;
  if (Math.random() >= SPAWN_CHANCE) {
    logger.info('📅 [EventScheduler] 5K Friday roll miss (30% chance)');
    return;
  }

  const tomorrow = tomorrowStockholm(); // torsdag kväll → imorgon = fredag
  const startsAt = atStockholm(tomorrow, 0, 0);
  const endsAt   = atStockholm(tomorrow, 23, 59);

  logger.info(`📅 [EventScheduler] 5K Friday triggered for ${tomorrow}`);
  await createForAllGroups('5K Friday', startsAt, endsAt);
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

  // Varje timme vid :05 — markerar expired participation-events som settled
  cron.schedule('5 * * * *', async () => {
    try {
      await settleExpiredParticipationEvents();
    } catch (e) {
      logger.error('❌ [EventScheduler] Participation settlement error:', e);
    }
  });

  logger.info('✅ Event scheduler started');
}
