import { STORM_EVENT_GUST_MS } from '@runquest/shared';

// Spelfakta som Playbook påstår men som ingen endpoint exponerar. Backend äger dem (event_templates i migrationerna,
// väderregeln i eventService, schemat i eventScheduler) — här är de en kopia, och `playbookFacts.test.ts` läser backendens
// källfiler och jämför, så texten inte glider ifrån koden i tysthet. Ändra backend → testet faller → uppdatera här.
// Strava-faktan är undantaget: den bor i packages/shared/src/rules.ts och testet jämför kopiorna nedan med de konstanterna.
// Reservkontrollens intervall (STRAVA_POLL_INTERVAL_HOURS) är ingen kopia: texterna läser det direkt ur shared via stravaPollIntervalLabel().

/** Vilka Strava-typer som importeras (shared/rules.ts: STRAVA_RUN_SPORT_TYPES); löpband följer med och märks via `trainer`. */
export const STRAVA_RUN_TYPES_LABEL = 'Run, Trail Run and Virtual Run';

/**
 * Deltagarevent. Namnen är produktionens (engelska — verifierat mot prod 2026-10-05; migration 025/029 seedar dem), siffrorna migration
 * 017/022/024/028. Timmar = Stockholm-tid, `to` = sluttimme (end_hour).
 */
export const EVENT_FACTS = {
  morning: { name: 'Morning run', from: 5, to: 9, minKm: 3, xp: 25 },
  evening: { name: 'Evening run', from: 18, to: 22, minKm: 3, xp: 25 },
  fiveKFriday: { name: '5K Friday', minKm: 5, xp: 25 },
  halfMarathon: { name: 'Half Marathon Chaser', minKm: 10, xp: 25 },
  hangover: { name: 'Hangover Run', minKm: 3, xp: 30 },
  /**
   * Väderregeln i eventService.checkStormChaserForecast: imorgondagens dagtimmar (06–21). Byarna hämtas med
   * `wind_speed_unit=ms`, så tröskeln är i m/s (issue #19; före v0.5.3 jämfördes km/h).
   */
  storm: { name: 'Storm Chaser', minKm: 5, xp: 40, stormHours: 3, gustHours: 4, gustMs: STORM_EVENT_GUST_MS, dayFrom: 6, dayTo: 21 },
} as const;

/** Veckotävlingarna (Weekly km och Weekly elevation, 7 dagar) — pris för plats 1–3 (migration 017). */
export const WEEKLY_COMPETITIONS = ['Weekly km', 'Weekly elevation'] as const;

/** Veckotävlingens pris för plats 1–3 (migration 017). */
export const WEEKLY_XP = [40, 30, 20] as const;
