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
  // Räkna ut UTC-offset för Stockholm på detta datum via noon-metoden
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

// ─── Storm Chaser — väderbaserat event ───────────────────────────────────────

/**
 * Körs dagligen 19:00 Stockholm — kollar prognos för imorgon.
 * Om dåligt väder förväntas (regn/åska/hård vind) skapas Storm Chaser för imorgon.
 * Storm Chaser: hela dygnet 00:00–23:59.
 */
async function maybeScheduleStormChaser(): Promise<void> {
  const qualifies = await checkStormChaserForecast();
  if (!qualifies) return;

  const tomorrow = tomorrowStockholm();
  const startsAt = atStockholm(tomorrow, 0, 0);
  const endsAt   = atStockholm(tomorrow, 23, 59);

  logger.info(`🌩️ [EventScheduler] Storm Chaser triggered for ${tomorrow}`);
  await createForAllGroups('Storm Chaser', startsAt, endsAt);
}

// ─── Dagliga participation events ────────────────────────────────────────────

/**
 * Körs varje kväll 19:00 Stockholm — skapar Morgonrunda för imorgon.
 * Morgonrunda: 06:00–10:00 (window_hours=4).
 */
async function scheduleMorningEvents(): Promise<void> {
  const tomorrow = tomorrowStockholm();
  const startsAt = atStockholm(tomorrow, 6, 0);
  const endsAt   = atStockholm(tomorrow, 10, 0);

  logger.info(`📅 [EventScheduler] Scheduling Morgonrunda for ${tomorrow}`);
  await createForAllGroups('Morgonrunda', startsAt, endsAt);
}

/**
 * Körs varje kväll 19:00 Stockholm — skapar Kvällsrunda för imorgon.
 * Kvällsrunda: 18:00–22:00 (window_hours=4).
 */
async function scheduleEveningEvents(): Promise<void> {
  const tomorrow = tomorrowStockholm();
  const startsAt = atStockholm(tomorrow, 18, 0);
  const endsAt   = atStockholm(tomorrow, 22, 0);

  logger.info(`📅 [EventScheduler] Scheduling Kvällsrunda for ${tomorrow}`);
  await createForAllGroups('Kvällsrunda', startsAt, endsAt);
}

// ─── Helg-event ───────────────────────────────────────────────────────────────

/**
 * Körs Fredag + Lördag 22:00 Stockholm — skapar Hangover Run för dagen efter.
 * Hangover Run: 00:00–23:59 (window_hours=24).
 * Fredag kväll → Lördag. Lördag kväll → Söndag (nyårsdagen-logik skött separat).
 */
async function scheduleHangoverRun(): Promise<void> {
  const tomorrow = tomorrowStockholm();
  const startsAt = atStockholm(tomorrow, 0, 0);
  const endsAt   = atStockholm(tomorrow, 23, 59);

  logger.info(`📅 [EventScheduler] Scheduling Hangover Run for ${tomorrow}`);
  await createForAllGroups('Hangover Run', startsAt, endsAt);
}

// ─── Torsdag — 5K Friday (eller alternativ) ──────────────────────────────────

/**
 * Körs Torsdag 18:00 Stockholm — skapar 5K Friday för imorgon (fredagen).
 * 5K Friday: 00:00–23:59 fredag (window_hours=24).
 */
async function scheduleFridayEvent(): Promise<void> {
  const tomorrow = tomorrowStockholm(); // torsdag kväll → imorgon = fredag
  const startsAt = atStockholm(tomorrow, 0, 0);
  const endsAt   = atStockholm(tomorrow, 23, 59);

  logger.info(`📅 [EventScheduler] Scheduling 5K Friday for ${tomorrow}`);
  await createForAllGroups('5K Friday', startsAt, endsAt);
}

// ─── Lördag — Lottning weekly competition events ──────────────────────────────

/**
 * Körs Lördag 20:00 Stockholm — lottar och skapar veckotävlingar som startar Måndag 00:01.
 * Lördag + 2 dagar = Måndag (start), Lördag + 8 dagar = Söndag (slut).
 */
async function scheduleWeeklyCompetitions(): Promise<void> {
  const today   = new Intl.DateTimeFormat('sv-SE', { timeZone: STOCKHOLM }).format(new Date());
  const monday  = addDaysToDate(today, 2);
  const sunday  = addDaysToDate(today, 8);
  const startsAt = atStockholm(monday, 0, 1);
  const endsAt   = atStockholm(sunday, 23, 59);

  logger.info(`📅 [EventScheduler] Lottning: Weekly competitions ${monday} 00:01 → ${sunday} 23:59`);
  await Promise.allSettled([
    createForAllGroups('Weekly km', startsAt, endsAt),
    createForAllGroups('Weekly höjdmeter', startsAt, endsAt),
  ]);
}

// ─── Scheduler entry point ───────────────────────────────────────────────────

export function startEventScheduler(): void {
  logger.info('📅 Starting event scheduler...');

  // Dagligen 19:00 Stockholm ≈ 17:00 UTC (täcker CET och CEST)
  // Skapar Morgonrunda + Lunch Run för imorgon
  cron.schedule('0 17 * * *', async () => {
    logger.info('⏰ [EventScheduler] Daily morning/lunch/storm event creation...');
    try {
      await Promise.allSettled([
        scheduleMorningEvents(),
        scheduleEveningEvents(),
        maybeScheduleStormChaser(),
      ]);
    } catch (e) {
      logger.error('❌ [EventScheduler] Daily event creation error:', e);
    }
  });

  // Fredag + Lördag 22:00 Stockholm ≈ 20:00 UTC
  // Skapar Hangover Run för nästkommande dag
  cron.schedule('0 20 * * 5,6', async () => {
    logger.info('⏰ [EventScheduler] Weekend Hangover Run creation...');
    try {
      await scheduleHangoverRun();
    } catch (e) {
      logger.error('❌ [EventScheduler] Hangover Run creation error:', e);
    }
  });

  // Torsdag 18:00 Stockholm ≈ 16:00 UTC
  // Skapar 5K Friday för imorgon (fredag)
  cron.schedule('0 16 * * 4', async () => {
    logger.info('⏰ [EventScheduler] Thursday — scheduling 5K Friday...');
    try {
      await scheduleFridayEvent();
    } catch (e) {
      logger.error('❌ [EventScheduler] 5K Friday creation error:', e);
    }
  });

  // Lördag 20:00 Stockholm ≈ 18:00 UTC — lottar och skapar Weekly km + Weekly höjdmeter
  // Events startar Måndag 00:01 Stockholm (2 dagar senare)
  cron.schedule('0 18 * * 6', async () => {
    logger.info('⏰ [EventScheduler] Saturday draw — scheduling weekly competitions...');
    try {
      await scheduleWeeklyCompetitions();
    } catch (e) {
      logger.error('❌ [EventScheduler] Weekly competition creation error:', e);
    }
  });

  // Söndag 23:55 Stockholm ≈ 21:55 UTC (täcker CET och CEST)
  // Settlerar avslutade competition-events och delar ut poolad XP
  cron.schedule('55 21 * * 0', async () => {
    logger.info('⏰ [EventScheduler] Sunday settlement — settling competition events...');
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
