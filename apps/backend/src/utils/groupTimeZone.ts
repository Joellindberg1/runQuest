// Backendens ingång till gruppens tidszon (ägarbeslut 2026-10-20). Backendkod som räknar ett dygn för en grupp hämtar zonen här och skickar den vidare
// till shared:s kalenderfunktioner (zoneDay, zoneMidnightIso, planBoostWindow, ...).
//
// Tidszon per grupp (RUN-21, `season.timezone` i group_settings) finns inte än: utan källa är varje grupps zon STOCKHOLM_TZ. RUN-21 anropar
// setGroupTimeZoneSource en gång vid uppstart med en funktion som läser gruppens inställning. Det byter zonen för ALLA ställen som går via resolvern
// (nedan), men INTE för de som inte gör det. De är RUN-21:s ARBETSLISTA: varje rad nedan räknar fortfarande dygn i Stockholm och måste få gruppens zon
// (eller bli ett medvetet globalt undantag) innan en grupp i en annan zon får rätt dygn där. En ny grupp i en annan zon blir inte rätt av att källan byts.
//
// GÅR VIA RESOLVERN (gruppens zon): boostens fönster när en duell avgörs (challengeService.settleChallenge), eventgränserna (eventService.checkEventQualification
// och settleCompetitionEvents, routes/events.ts, rankNews, leaderboard rank-delta och /week, inklusive XP-liggarens datering av event-XP via
// buildXpLedger(..., timeZone)), "idag" och framtidskontrollen i routes/runs.ts (validateRunInput),
// titleNews, utmaningens aktuella dag i getProgressForChallenge, gruppens första dag i joinGroup.
//
// GÅR INTE VIA RESOLVERN (Stockholm, att åtgärda i RUN-21):
//   Utmaningar
//   - routes/challenges.ts:378  groupNextMidnight(new Date()) vid accept (zonparametern finns men får inte gruppens zon).
//   - scheduler/challengeScheduler.ts:54  groupNextMidnight(new Date()) vid legendary-autostart (samma).
//   - shared/challengeWindow.ts  challengeWindow(...).determineAt: 03:00 via stockholmWallClockToInstant, utan zon.
//   Streak
//   - services/streakService.ts:57  currentStreak(days, stockholmDay(new Date())).
//   Aktivitetsloggen
//   - shared/activity.ts  streakBrokenOccurredAt (streak_broken kl 00:00 Stockholm dag last_run_date + 2, stockholmMidnightIso) och dedupe-nyckelns dag för
//     rank_passed (stockholmDay(new Date(occurredAt)), rad ~506).
//   - shared/activityBackfill.ts  fyra stockholmMidnightIso (utmaningens slut, rundors datum, cutoff).
//   Schemaläggare (globala jobb för alla grupper, cron i STOCKHOLM_TZ; ett slag skapar samma instanter åt alla grupper)
//   - scheduler/eventScheduler.ts  "imorgon", veckotävlingens måndag och söndag och starttiderna (stockholmDay, stockholmWallClockToInstant).
//   - scheduler/streakScheduler.ts, stravaSync.ts, stravaWebhookScheduler.ts, stravaReconcileScheduler.ts, recalculationRecoveryScheduler.ts (cron-optionen).
//   - services/eventService.ts checkStormChaserForecast: fasta Stockholm-koordinater, så Stockholms morgondag är avsiktligt.
//   Strava (en användares egen tid, inte en grupps)
//   - services/stravaReconcile/plan.ts, utils/stravaLookback.ts, shared/rules.ts (nextStravaPollSlot): fönster och slots i Stockholm.
//   Titlar
//   - titleEngines/winterKm.ts och maxKmRolling30.ts: TitleContext har ingen zon, så winterWindow(now, timeZone) får aldrig en annan zon än standardzonen.
//   Nya grupper och skript
//   - utils/membership.ts createGroupWithAdmin (p_today), scripts/backfillActivityLog.ts, scripts/createGroup.ts, scripts/staging/stagingSeedGroup.ts, scripts/loadtest/scenarios.mjs.
//   Frontend (ingen zon i payloaden, accepterat 2026-10-20 och noterat för RUN-21)
//   - Servern skickar ingen zon till klienten, så alla frontendmodeller räknar dygn i standardzonen. De som rör boostar, 14-dagarssnittet och nyhetsraden tar
//     `timeZone` som parameter (duelsModel.buildBoosts, leaderboardUtils.calculateLast14DaysXP, NewsContext), men ingen anropare skickar något. Övriga använder
//     stockholmClock/zoneDay utan zon: app-shell/rightNowItems.ts, features/events/eventsFormat.ts, features/challenges/duelsFormat.ts, features/leaderboard/boardFormat.ts,
//     features/profile/statsModel.ts, features/runner/runnerModel.ts, features/settings/settingsModel.ts, features/news/newsModel.ts, pages/BoardPage.tsx,
//     pages/preview/ActiveChallengeWidget.tsx. RUN-21 lägger zonen i payloaden (t.ex. i auth-svaret eller /groups/me) och skickar den vidare.
import { groupTimeZone as resolveGroupTimeZone, type GroupTimeZoneSource } from '@runquest/shared';

let source: GroupTimeZoneSource | undefined;

/** Byter källan för gruppernas zoner. Utan argument tillbaka till standardzonen. Testerna skickar en annan zon genom resolvern här. */
export function setGroupTimeZoneSource(next?: GroupTimeZoneSource): void {
  source = next;
}

/** Gruppens IANA-tidszon. Okänd grupp (null) eller en ogiltig zon ger Stockholm. */
export function groupTimeZone(groupId: string | null | undefined): string {
  return resolveGroupTimeZone(groupId, source);
}
