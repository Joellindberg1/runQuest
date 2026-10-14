// Passeringsdetektion för rank_passed (ADR 011 beslut 6). Ren funktion: ingen databas, ingen klocka — "idag" kommer in som
// Stockholm-dag och skrivpunkterna (services/rankNews.ts, settleChallenge) läser data och skriver raderna.
import { activityKeys, type RankMeasure } from './activity.js';
import { compareByNameThenId } from './leaderboard.js';

// ─── Komparatorer per mått ──────────────────────────────────────────────────────────────────────

/** Ställning i utmaningstabellen: vinster, oavgjorda och förluster. */
export interface ChallengeRecord {
  wins: number;
  draws: number;
  losses: number;
}

/** En rad i utmaningstabellen (GET /challenges/group-stats) eller en medlems ställning i detektionen. */
export interface ChallengeStanding extends ChallengeRecord {
  id: string;
  name: string;
}

/** Medlem i xp-tabellen. Samma ordning som rank-delta/buildRankDelta. */
export interface XpStanding {
  id: string;
  name: string;
  xp: number;
}

/** Poäng = (vinster + oavgjorda × 0,5) / spelade matcher; 0 för noll matcher. ALDRIG avrundad — avrundning hör till presentationen. */
export function challengeScore(wins: number, draws: number, losses: number): number {
  const played = wins + draws + losses;
  return played > 0 ? (wins + draws * 0.5) / played : 0;
}

/**
 * Utmaningstabellens ordning (ägarbeslut Ö8), total och deterministisk:
 *   1. de som spelat minst en match före de som inte spelat någon (noll matcher rankas sist; en spelare med bara förluster
 *      har 0 poäng men ligger ändå över en spelare utan matcher),
 *   2. poäng fallande, på OAVRUNDADE poäng,
 *   3. vinster fallande,
 *   4. namn stigande skiftlägesokänsligt, 5. id (compareByNameThenId).
 * Används av både detektionen och GET /challenges/group-stats så att tabellen och rank_passed aldrig kan skilja sig åt.
 */
export function compareChallengeStandings(a: ChallengeStanding, b: ChallengeStanding): number {
  const aPlayed = a.wins + a.draws + a.losses > 0;
  const bPlayed = b.wins + b.draws + b.losses > 0;
  if (aPlayed !== bPlayed) return aPlayed ? -1 : 1;
  const aScore = challengeScore(a.wins, a.draws, a.losses);
  const bScore = challengeScore(b.wins, b.draws, b.losses);
  if (aScore !== bScore) return aScore > bScore ? -1 : 1;
  if (a.wins !== b.wins) return a.wins > b.wins ? -1 : 1;
  return compareByNameThenId(a, b);
}

/** All-time-tabellens ordning: xp fallande, därefter namn/id. Byggd på compareByNameThenId, precis som buildRankDelta. */
export function compareXpStandings(a: XpStanding, b: XpStanding): number {
  if (a.xp !== b.xp) return a.xp > b.xp ? -1 : 1;
  return compareByNameThenId(a, b);
}

// ─── Detektion ───────────────────────────────────────────────────────────────────────────────────

/**
 * En gruppmedlem i detektionen. Värdena `V` är det mått som mäts: ett tal för xp, `ChallengeRecord` för challenge_points.
 *  - `before`/`after`: värdet före och efter skrivningen som utlöser detektionen (för andra än W oftast samma).
 *  - `midnight`: värdet vid dygnsskiftet (Stockholm 00:00 idag); null = fanns inte då.
 *  - `createdDate`: Stockholm-dagen medlemmen skapades (null = okänt, räknas som medlem). En medlem skapad idag eller senare
 *    har ingen rang vid dygnsskiftet även om `midnight` är ett tal (xp:s previous_xp klampas till 0), samma regel som buildRankDelta.
 */
export interface RankPassMember<V> {
  id: string;
  name: string;
  createdDate: string | null;
  midnight: V | null;
  before: V;
  after: V;
}

interface RankPassInputBase<M extends RankMeasure, V> {
  measure: M;
  /** W, den som passerar (den vars mått skrevs). */
  passerId: string;
  /** Idag som Stockholm-dag (YYYY-MM-DD). Detektionen läser aldrig klockan. */
  today: string;
  /** Hela gruppen inklusive W. Ordningen i listan spelar ingen roll. */
  members: ReadonlyArray<RankPassMember<V>>;
}

export type DetectRankPassesInput =
  | RankPassInputBase<'xp', number>
  | RankPassInputBase<'challenge_points', ChallengeRecord>;

/** Anpassad till `buildRankPassedDraft(groupId, measure, passerId, passedId, passerRank, passedRank, occurredAt)`. */
export interface RankPass {
  passerId: string;
  passedId: string;
  /** W:s rang EFTER passeringen (1-baserad, samma för alla rader i ett anrop). */
  passerRank: number;
  /** M:s rang EFTER passeringen. */
  passedRank: number;
  dedupeKey: string;
}

export interface RankPassResult {
  /** En rad per passerad medlem, sorterade på passedRank. */
  passes: RankPass[];
  /** Dagens deterministiska nycklar att retracta (retractActivity) efter en minskning; äldre dagars rader rörs aldrig. */
  retractKeys: string[];
}

interface Standing<V> {
  id: string;
  name: string;
  value: V;
}

type StandingCompare<V> = (a: Standing<V>, b: Standing<V>) => number;

const XP_COMPARE: StandingCompare<number> = (a, b) =>
  compareXpStandings({ id: a.id, name: a.name, xp: a.value }, { id: b.id, name: b.name, xp: b.value });

const CHALLENGE_COMPARE: StandingCompare<ChallengeRecord> = (a, b) =>
  compareChallengeStandings({ id: a.id, name: a.name, ...a.value }, { id: b.id, name: b.name, ...b.value });

/** Positivt om `after` är ett sämre värde än `before`, negativt om bättre, 0 om oförändrat. Namn och id ingår aldrig. */
type MeasureMovement<V> = (after: V, before: V) => number;

const XP_MOVEMENT: MeasureMovement<number> = (after, before) => (after === before ? 0 : after < before ? 1 : -1);

/**
 * challenge_points rör sig på (oavrundade poäng, vinster) och ingenting annat (ägarbeslut Ö8). Steget "spelat före ej spelat"
 * ur tabellordningen ingår INTE: 0-0-0 till 0-0-1 flyttar en spelare över dem utan matcher i tabellen, men måttet har inte ökat,
 * och rank_passed kräver att W:s mått ökat (ADR 011 beslut 6.4).
 */
const CHALLENGE_MOVEMENT: MeasureMovement<ChallengeRecord> = (after, before) => {
  const a = challengeScore(after.wins, after.draws, after.losses);
  const b = challengeScore(before.wins, before.draws, before.losses);
  if (a !== b) return a < b ? 1 : -1;
  if (after.wins !== before.wins) return after.wins < before.wins ? 1 : -1;
  return 0;
};

interface MeasureRules<V> {
  /** Tabellordningen: korsning och rang. */
  compare: StandingCompare<V>;
  /** Rörelse: bara värdet, aldrig tabellens spelat/ej-spelat- eller namnsteg. */
  moved: MeasureMovement<V>;
}

/** Ett mått per RankMeasure; `satisfies` gör att ett nytt mått i RANK_MEASURES inte kompilerar förrän det har regler här. */
const MEASURES = {
  xp: { compare: XP_COMPARE, moved: XP_MOVEMENT } satisfies MeasureRules<number>,
  challenge_points: { compare: CHALLENGE_COMPARE, moved: CHALLENGE_MOVEMENT } satisfies MeasureRules<ChallengeRecord>,
} satisfies Record<RankMeasure, unknown>;

/**
 * Vilka passeringar gav W:s skrivning, och vilka av dagens rader ska återtas?
 *
 * För varje annan medlem M gäller ALLA av:
 *  1. Korsning: W låg bakom M före (`before`) och ligger före M efter (`after`), enligt måttets komparator.
 *  2. W låg bakom M vid dygnsskiftet (`midnight`), och båda fanns då (se `createdDate`).
 *  3. Max en rad per ordnat par, mått och dag: `activityKeys.rankPassed(measure, W, M, today)`.
 *
 * Rang = 1-baserad position när ALLA medlemmar (inklusive W) sorteras med komparatorn på `after`-värdena. Komparatorn är en
 * total ordning (namn/id som sista steg), så två medlemmar delar aldrig rang. Rangerna i utdata är rangerna EFTER passeringen.
 *
 * Bara uppåt. Rörelsen (upp, ned, oförändrat) avgörs av W:s egna `before` och `after`:
 *  - xp: det råa talet.
 *  - challenge_points: (oavrundade poäng, vinster) och inget annat. Tabellens steg "spelat före ej spelat" räknas INTE som
 *    rörelse, så 0-0-0 till 0-0-1 är oförändrat och ger ingen rad, även om tabellen då lyfter spelaren över dem utan matcher.
 *    En seger är alltid upp, ett oavgjort från 1,0 är ned och en förlust är ned eller oförändrad.
 * Korsning och rang använder däremot alltid hela tabellordningen.
 *
 * Vid en minskning skapas inga rader. `retractKeys` innehåller då dagens nyckel för varje M som W låg före förut men nu åter
 * ligger bakom. Nyckeln återtas även om raden aldrig skrivits (retractActivity är icke-kastande och en retract av en
 * obefintlig rad är harmlös), eftersom dygnsskiftets rangordning kan ha ändrats av minskningen och den skrivna raden då inte
 * går att härleda ur dagens indata. Regeln är smal med flit: en gammal rad kan ligga kvar om M hann gå förbi W igen innan W:s
 * minskning (W ligger då redan bakom M före minskningen och ingen nyckel returneras). Oförändrat mått ger ingenting.
 *
 * W saknas i `members` => tomt resultat (kastar aldrig).
 */
export function detectRankPasses(input: DetectRankPassesInput): RankPassResult {
  return input.measure === 'xp'
    ? detect(input, MEASURES.xp)
    : detect(input, MEASURES.challenge_points);
}

function detect<V>(input: RankPassInputBase<RankMeasure, V>, { compare, moved }: MeasureRules<V>): RankPassResult {
  const empty: RankPassResult = { passes: [], retractKeys: [] };
  const { measure, passerId, today, members } = input;
  const passer = members.find((m) => m.id === passerId);
  if (!passer) return empty;

  const at = (m: RankPassMember<V>, value: V): Standing<V> => ({ id: m.id, name: m.name, value });
  const before = (m: RankPassMember<V>) => at(m, m.before);
  const after = (m: RankPassMember<V>) => at(m, m.after);

  const movement = moved(passer.after, passer.before);
  if (movement === 0) return empty;
  const decreased = movement > 0;

  const rankAfter = new Map<string, number>();
  members
    .map(after)
    .sort(compare)
    .forEach((s, i) => rankAfter.set(s.id, i + 1));

  // En medlem har rang vid dygnsskiftet om värdet finns och hen skapades före idag (som buildRankDelta).
  const existedAtMidnight = (m: RankPassMember<V>): m is RankPassMember<V> & { midnight: V } =>
    m.midnight !== null && (m.createdDate === null || m.createdDate < today);

  const others = members
    .filter((m) => m.id !== passerId)
    .sort((a, b) => (rankAfter.get(a.id) as number) - (rankAfter.get(b.id) as number));

  if (decreased) {
    const retractKeys = others
      .filter((m) => compare(before(passer), before(m)) < 0 && compare(after(passer), after(m)) > 0)
      .map((m) => activityKeys.rankPassed(measure, passerId, m.id, today));
    return { passes: [], retractKeys };
  }

  const passerRank = rankAfter.get(passerId) as number;
  const passes: RankPass[] = [];
  for (const m of others) {
    const crossed = compare(before(passer), before(m)) > 0 && compare(after(passer), after(m)) < 0;
    if (!crossed) continue;
    if (!existedAtMidnight(passer) || !existedAtMidnight(m)) continue;
    if (compare(at(passer, passer.midnight), at(m, m.midnight)) <= 0) continue; // W låg inte bakom M vid dygnsskiftet
    passes.push({
      passerId, passedId: m.id, passerRank, passedRank: rankAfter.get(m.id) as number,
      dedupeKey: activityKeys.rankPassed(measure, passerId, m.id, today),
    });
  }
  return { passes, retractKeys: [] };
}
