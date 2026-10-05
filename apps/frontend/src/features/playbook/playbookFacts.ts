// Spelfakta som Playbook påstår men som ingen endpoint exponerar. Backend äger dem (event_templates i migrationerna,
// väderregeln i eventService, schemat i eventScheduler) — här är de en kopia, och `playbookFacts.test.ts` läser backendens
// källfiler och jämför, så texten inte glider ifrån koden i tysthet. Ändra backend → testet faller → uppdatera här.

/** Deltagarevent (migration 017, 022, 024, 028). Timmar = Stockholm-tid, `to` = sluttimme (end_hour). */
export const EVENT_FACTS = {
  morning: { name: 'Morgonrunda', from: 5, to: 9, minKm: 3, xp: 25 },
  evening: { name: 'Kvällsrunda', from: 18, to: 22, minKm: 3, xp: 25 },
  fiveKFriday: { name: '5K Friday', minKm: 5, xp: 25 },
  halfMarathon: { name: 'Half Marathon Chaser', minKm: 10, xp: 25 },
  hangover: { name: 'Hangover Run', minKm: 3, xp: 30 },
  /** Väderregeln i eventService.checkStormForecast: imorgondagens dagtimmar (06–21). */
  storm: { name: 'Storm Chaser', minKm: 5, xp: 40, stormHours: 3, gustHours: 4, gustMs: 15, dayFrom: 6, dayTo: 21 },
} as const;

/** Veckotävlingens pris för plats 1–3 (migration 017). */
export const WEEKLY_XP = [40, 30, 20] as const;
