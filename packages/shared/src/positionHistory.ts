// Positionshistorik per vecka (ADR 007 B11) — ren funktion, ingen I/O och ingen klocka.
// Placeringen vid slutet av varje avslutad vecka räknas bakåt ur total_xp med samma hjälpfunktion som rank-delta (`xpBeforeDate`) och
// ordnas med Standings komparator (`compareXpStandings`), så grafen och pilarna på Standings inte kan säga emot varandra.
import type { PositionHistoryResponse, PositionRunner, PositionWeek } from './contracts/leaderboard.js';
import { STOCKHOLM_TZ, addDays, isoWeekNumber, isoWeekYear, mondayOf, zoneDay } from './calendar.js';
import { compareXpStandings } from './rankPasses.js';
import { xpBeforeDate, type XpLedgerEntry } from './xpLedger.js';

export interface PositionHistoryUser {
  id: string;
  name: string;
  profile_picture: string | null;
  /** users.total_xp: Standings och den pågående veckan. */
  total_xp: number;
  /** ISO-tidpunkt (users.created_at). null = okänt → närvarande i alla veckor. */
  created_at: string | null;
}

export interface PositionHistoryResult {
  response: PositionHistoryResponse;
  /** Användare vars liggare överstiger total_xp i någon vecka (XP:n klampades till 0). Unika id:n. */
  diverged: string[];
}

/**
 * `weeks` är hela antalet veckor inklusive den pågående (heltal ≥ 1; taket POSITION_WEEKS_MAX hör till routen). Veckogränserna är
 * kalenderdagar i `timeZone`, så sommartid kan inte flytta en gräns. Förledande veckor där ingen är närvarande beskärs bort, så
 * `weeks.length` kan bli mindre än begärt; den pågående veckan finns alltid kvar.
 */
export function buildPositionHistory(
  users: ReadonlyArray<PositionHistoryUser>,
  ledger: XpLedgerEntry[],
  now: Date,
  weeks: number,
  timeZone: string = STOCKHOLM_TZ,
): PositionHistoryResult {
  if (!Number.isInteger(weeks) || weeks < 1) throw new RangeError('weeks must be an integer of at least 1');

  const today = zoneDay(now, timeZone);
  const currentStart = mondayOf(today);
  const entryDay = new Map(users.map((u) => [u.id, u.created_at ? zoneDay(new Date(u.created_at), timeZone) : null]));

  // Närvaro: kontot skapades före veckans slutgräns (måndagen efter). Saknat created_at = alltid närvarande.
  const presentAt = (boundary: string) => users.filter((u) => {
    const day = entryDay.get(u.id) ?? null;
    return day === null || day < boundary;
  });

  const diverged = new Set<string>();
  const placementsByWeek: Array<Map<string, number>> = [];
  const weekDefs: PositionWeek[] = [];

  for (let k = 0; k < weeks; k += 1) {
    const start = addDays(currentStart, -7 * (weeks - 1 - k));
    const isCurrent = k === weeks - 1;
    const boundary = addDays(start, 7);

    let standings: Array<{ id: string; name: string; xp: number }>;
    if (isCurrent) {
      standings = users.map((u) => ({ id: u.id, name: u.name, xp: u.total_xp }));
    } else {
      const present = presentAt(boundary);
      if (present.length === 0 && placementsByWeek.length === 0) continue; // förledande vecka utan närvarande
      const { previousXp, diverged: over } = xpBeforeDate(present, ledger, boundary);
      over.forEach((id) => diverged.add(id));
      standings = present.map((u) => ({ id: u.id, name: u.name, xp: previousXp.get(u.id) ?? 0 }));
    }

    const placement = new Map<string, number>();
    // Plats = antalet som ligger före enligt komparatorn + 1; komparatorn är total, så ingen delar plats.
    [...standings].sort(compareXpStandings).forEach((s, i) => placement.set(s.id, i + 1));
    placementsByWeek.push(placement);
    weekDefs.push({ start, end: addDays(start, 6), iso_week: isoWeekNumber(start), iso_year: isoWeekYear(start), is_current_week: isCurrent });
  }

  const live = placementsByWeek[placementsByWeek.length - 1]!;
  const runners: PositionRunner[] = users
    .map((u) => ({
      user_id: u.id,
      name: u.name,
      profile_picture: u.profile_picture,
      member_since: entryDay.get(u.id) ?? null,
      positions: placementsByWeek.map((p) => p.get(u.id) ?? null),
    }))
    .sort((a, b) => live.get(a.user_id)! - live.get(b.user_id)!);

  return { response: { as_of: today, weeks: weekDefs, runners }, diverged: [...diverged] };
}
