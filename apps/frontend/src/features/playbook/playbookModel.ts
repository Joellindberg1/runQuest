import { FALLBACK_LEVEL_REQUIREMENTS, calculateCompleteRunXP, calculateRunXP, type LevelRequirement } from '@runquest/shared';
import { MIN_RUN_DATE, MIN_RUN_DISTANCE_KM } from '@/constants/appConstants';
import type { ChallengeTier } from '@runquest/types';
import { TIERS, tierLabel, type Stake } from '@/features/challenges/duelsFormat';
import { HOW_IT_WORKS, observedStakes } from '@/features/challenges/rulesModel';
import { formatInt, formatKm, formatLongDate } from '@/features/log/logFormat';
import type { XpRules } from '@/features/log/xpPreviewModel';
import { ALL_WAYPOINTS, JOURNEY_END_KM } from '@/features/profile/frodoModel';
import type { RQIconName } from '@/shared/components/icons';
import { MAX_DISPLAYED } from '@/features/titles/titlesModel';
import { EVENT_FACTS, WEEKLY_XP } from './playbookFacts';

// Playbook-skärmens kapitel: spelets regler som text, med siffrorna ur GET /config/xp (bas-XP, XP/km, distansbonusar,
// streak-trappan) i stället för hårdkodade. Nivåtabellen är shareds (enda hemmet, identisk med level_requirements i prod),
// titlarna kommer ur databasen (titleRules.ts). Sidan får bara påstå det koden gör: insatserna per utmaningsnivå är
// observerade (som Duels Rules-vy), utmaningsreglerna är Rules-vyns egna texter, och event-siffrorna är en kopia av backend
// (playbookFacts.ts) som playbookFacts.test.ts jämför mot backendens källfiler. Ren logik — ingen DOM.

export const CHAPTER_IDS = ['run', 'xp', 'streaks', 'levels', 'titles', 'challenges', 'events', 'frodo', 'fair-play'] as const;
export type ChapterId = (typeof CHAPTER_IDS)[number];
export const DEFAULT_CHAPTER: ChapterId = 'run';

export interface TableRow {
  label: string;
  value: string;
  /** Liten rad under etiketten ("5 km run: 31 XP"). */
  note?: string;
}

export interface ChapterTable {
  label: string;
  rows: TableRow[];
}

export interface Chapter {
  id: ChapterId;
  /** "01" … "09" */
  num: string;
  icon: RQIconName;
  /** Flikens och dragspelsradens namn. */
  label: string;
  title: string;
  lead: string;
  paras: string[];
  table: ChapterTable | null;
  /** Kapitlet visar titellistan ur databasen under texten. */
  showsTitleList: boolean;
}

// ─── Räkneexempel ur konfigurationen ──────────────────────────────────────────

const EXAMPLE_SHORT_KM = 5;
const EXAMPLE_LONG_KM = 10;

/** Rundans XP utan streak: samma shared-formel som servern räknar med. */
function plainRun(km: number, rules: XpRules) {
  return calculateRunXP(km, rules.settings);
}

/** Rundans XP med en streakdag och eventuell boost — `calculateCompleteRunXP` är enda formeln. */
function runWithStreak(km: number, streakDay: number, rules: XpRules, boostDelta = 0): number {
  return calculateCompleteRunXP(km, streakDay, rules.settings, rules.streak_multipliers, boostDelta).finalXP;
}

const times = (multiplier: number): string => `${Number(multiplier.toFixed(2))}×`;

// ─── Kapitel ──────────────────────────────────────────────────────────────────

function runChapter(rules: XpRules): Omit<Chapter, 'num'> {
  const manualMin = formatKm(MIN_RUN_DISTANCE_KM);
  return {
    id: 'run', icon: 'plus', label: 'What counts as a run', title: 'What counts as a run',
    lead: `Manual runs need at least ${manualMin} km; runs synced from Strava count at any distance.`,
    paras: [
      'Strava runs arrive by themselves every 30 minutes — running activities only (Run, Trail Run and Virtual Run), with duplicates filtered out. Each sync looks back to a week before your latest run, so a missed activity is picked up. Treadmill runs are tagged when Strava flags them as a trainer activity.',
      `You can also log a run by hand, back to ${formatLongDate(MIN_RUN_DATE)} and never into the future. Manual runs have no GPS, so no weather and no elevation. The XP formula is the same for both.`,
    ],
    table: {
      label: 'The basics',
      rows: [
        { label: 'Manual run, minimum', value: `${manualMin} km` },
        { label: 'Base XP from', value: `${formatKm(rules.settings.min_run_distance)} km` },
        { label: 'Strava import', value: 'Every 30 min' },
        { label: 'Logging by hand', value: `Since ${formatLongDate(MIN_RUN_DATE)}` },
      ],
    },
    showsTitleList: false,
  };
}

function xpChapter(rules: XpRules): Omit<Chapter, 'num'> {
  const { settings } = rules;
  const short = plainRun(EXAMPLE_SHORT_KM, rules);
  const long = plainRun(EXAMPLE_LONG_KM, rules);
  return {
    id: 'xp', icon: 'zap', label: 'The XP formula', title: 'The XP formula',
    lead: `Base ${settings.base_xp}, plus ${settings.xp_per_km} XP per kilometre, plus a distance bonus. Your streak multiplies the first two.`,
    paras: [
      'Nothing here is hidden and nothing is weighted per person. Two runners covering the same distance on the same streak earn exactly the same XP, whether the run came from Strava or was logged by hand.',
      `A ${EXAMPLE_SHORT_KM} km run is ${short.baseXP} + ${short.kmXP} + ${short.distanceBonus} = ${short.totalXP} XP before the streak. A ${EXAMPLE_LONG_KM} km run is ${long.baseXP} + ${long.kmXP} + ${long.distanceBonus} = ${long.totalXP} XP. The base is paid from ${formatKm(settings.min_run_distance)} km. The distance bonus is paid once per run, at the highest tier reached, and the streak never touches it.`,
    ],
    table: {
      label: 'The numbers',
      rows: [
        { label: 'Base per run', value: String(settings.base_xp) },
        { label: 'Per kilometre', value: `× ${settings.xp_per_km}` },
        { label: 'From 5 km', value: `+${settings.bonus_5km}` },
        { label: 'From 10 km', value: `+${settings.bonus_10km}` },
        { label: 'From 15 km', value: `+${settings.bonus_15km}` },
        { label: 'From 20 km', value: `+${settings.bonus_20km}` },
      ],
    },
    showsTitleList: false,
  };
}

function streaksChapter(rules: XpRules): Omit<Chapter, 'num'> {
  const ladder = [...rules.streak_multipliers].sort((a, b) => a.days - b.days);
  const top = ladder[ladder.length - 1];
  const plain = plainRun(EXAMPLE_SHORT_KM, rules).totalXP;
  const lead = top
    ? `Consecutive days with a run build a multiplier from 1.0× up to ${times(top.multiplier)}.`
    : 'Consecutive days with a run build a multiplier on your XP.';
  const paras = [
    'A streak counts unique days: running twice in one day still counts as one. Miss a whole day and you start again at 1.0× — there are no grace days.',
    'The multiplier applies to the base amount and the kilometre XP, not to the distance bonus.',
  ];
  if (top) {
    paras.push(`At ${times(top.multiplier)} a ${EXAMPLE_SHORT_KM} km run is worth ${runWithStreak(EXAMPLE_SHORT_KM, top.days, rules)} XP instead of ${plain}.`);
  }
  return {
    id: 'streaks', icon: 'flame', label: 'Streaks', title: 'Streaks', lead, paras,
    table: ladder.length === 0 ? null : {
      label: 'The ladder',
      rows: ladder.map((step) => ({
        label: `From day ${step.days}`,
        value: times(step.multiplier),
        note: `${EXAMPLE_SHORT_KM} km run: ${runWithStreak(EXAMPLE_SHORT_KM, step.days, rules)} XP`,
      })),
    },
    showsTitleList: false,
  };
}

/** Nivåerna tabellen visar (alla 30 vore en vägg av siffror). */
export const LEVEL_MILESTONES: readonly number[] = [2, 3, 4, 5, 10, 12, 14, 15, 18, 20, 23, 25, 30];

function levelsChapter(rules: XpRules, requirements: readonly LevelRequirement[]): Omit<Chapter, 'num'> {
  const short = plainRun(EXAMPLE_SHORT_KM, rules).totalXP;
  const long = plainRun(EXAMPLE_LONG_KM, rules).totalXP;
  const runs = (xp: number, perRun: number): string => (perRun > 0 ? (xp / perRun).toFixed(1) : '—');
  const rows = LEVEL_MILESTONES.flatMap((level) => {
    const requirement = requirements.find((candidate) => candidate.level === level);
    return requirement
      ? [{
        label: `Level ${level}`,
        value: `${formatInt(requirement.xp_required)} XP`,
        note: `${runs(requirement.xp_required, short)} runs of ${EXAMPLE_SHORT_KM} km · ${runs(requirement.xp_required, long)} of ${EXAMPLE_LONG_KM} km`,
      }]
      : [];
  });
  return {
    id: 'levels', icon: 'trophy', label: 'Levels', title: 'Levels',
    lead: 'Levels get progressively more expensive, so the leader is never the fastest climber.',
    paras: [
      'The bar on the leaderboard shows progress into your current level, not your share of the season. A newer runner on a good streak can level twice while the leader levels once.',
      `The top level is ${requirements.length}. The table counts runs without any streak bonus.`,
    ],
    table: { label: 'XP to reach', rows },
    showsTitleList: false,
  };
}

function titlesChapter(): Omit<Chapter, 'num'> {
  return {
    id: 'titles', icon: 'crown', label: 'Titles', title: 'Titles',
    lead: 'Titles are held, not awarded. Beat the holder’s number and the title moves to you.',
    paras: [
      'Each title belongs to whoever has the best value for its metric right now, and the holders are recalculated after every run. Some titles have to be unlocked first: until someone passes the threshold the title sits empty, with the best attempt on show.',
      `You can show up to ${MAX_DISPLAYED} titles on your leaderboard card.`,
    ],
    table: null,
    showsTitleList: true,
  };
}

const howItWorks = (title: string): string => HOW_IT_WORKS.find((item) => item.title === title)?.body ?? '';

function challengesChapter(stakes: Record<ChallengeTier, Stake>): Omit<Chapter, 'num'> {
  return {
    id: 'challenges', icon: 'swords', label: 'Challenges', title: 'Challenges',
    // Rules-vyns egna texter (features/challenges/rulesModel): EN formulering av reglerna, så Playbook och Duels inte kan säga olika saker.
    lead: howItWorks('One token, one duel'),
    paras: [
      'A token is earned at a level-up. Its tier, metric, length and stakes are drawn when you earn it — minor at most level-ups, major roughly every fifth level, legendary every fifteenth. Sending a challenge means choosing one of your tokens and an opponent.',
      `${howItWorks('Metrics')} ${howItWorks('The boost')}`,
    ],
    table: {
      label: 'The stakes',
      rows: TIERS.flatMap((tier) => [
        { label: `${tierLabel(tier)} · win`, value: stakes[tier].win },
        { label: `${tierLabel(tier)} · lose`, value: stakes[tier].lose },
      ]),
    },
    showsTitleList: false,
  };
}

const hourText = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;

function eventsChapter(): Omit<Chapter, 'num'> {
  const { morning, evening, fiveKFriday, halfMarathon, hangover, storm } = EVENT_FACTS;
  return {
    id: 'events', icon: 'calendar', label: 'Events', title: 'Events',
    lead: 'Events are drawn by chance, so not every day or week has one. In a participation event you finish a run inside the window and get the XP — no ranking, everyone who qualifies wins.',
    paras: [
      `Morgonrunda, Kvällsrunda and Storm Chaser share a daily draw at 19:00 — at most one of them starts the next day. Storm Chaser only comes up when tomorrow's daytime forecast (${hourText(storm.dayFrom)}–${hourText(storm.dayTo)}) shows at least ${storm.stormHours} hours of rain, snow or thunder, or at least ${storm.gustHours} hours of gusts of ${storm.gustMs} m/s or more.`,
      `Weekly competitions are the exception: a weekly km or elevation competition runs Monday to Sunday, ranks everyone on the total, and is settled just after midnight on Monday. The top three get ${WEEKLY_XP.join(' / ')} XP.`,
      'Event XP is tracked separately from run XP. It counts toward your total and your level, but it is not part of the per-run breakdown.',
    ],
    table: {
      label: 'Participation events',
      rows: [
        { label: morning.name, note: `${hourText(morning.from)}–${hourText(morning.to)} · min ${morning.minKm} km`, value: `+${morning.xp}` },
        { label: evening.name, note: `${hourText(evening.from)}–${hourText(evening.to)} · min ${evening.minKm} km`, value: `+${evening.xp}` },
        { label: fiveKFriday.name, note: `All Friday · min ${fiveKFriday.minKm} km`, value: `+${fiveKFriday.xp}` },
        { label: halfMarathon.name, note: `Friday to Sunday · min ${halfMarathon.minKm} km`, value: `+${halfMarathon.xp}` },
        { label: hangover.name, note: `A Saturday or Sunday · min ${hangover.minKm} km`, value: `+${hangover.xp}` },
        { label: storm.name, note: `Weather only · min ${storm.minKm} km`, value: `+${storm.xp}` },
      ],
    },
    showsTitleList: false,
  };
}

function frodoChapter(): Omit<Chapter, 'num'> {
  const majors = ALL_WAYPOINTS.filter((waypoint) => waypoint.tier === 1);
  const between = ALL_WAYPOINTS.length - majors.length;
  return {
    id: 'frodo', icon: 'sparkles', label: 'Frodo’s journey', title: 'Frodo’s journey',
    lead: `Every kilometre you log walks you along the ${formatInt(JOURNEY_END_KM)} km from The Shire to Mount Doom.`,
    paras: [
      `The big checkpoints sit where you would expect, and ${between} smaller ones fill the gaps — Weathertop, the Doors of Durin, the Dead Marshes. Your place on the road is on your profile and your runner card.`,
    ],
    table: {
      label: 'Checkpoints',
      rows: majors.map((waypoint) => ({ label: waypoint.name, value: `${formatInt(waypoint.km)} km` })),
    },
    showsTitleList: false,
  };
}

function fairPlayChapter(): Omit<Chapter, 'num'> {
  return {
    id: 'fair-play', icon: 'shield', label: 'Fair play', title: 'Fair play',
    lead: 'The formula is public, and the numbers on this page are the ones the game really uses.',
    paras: [
      'A Strava activity is stored once — duplicate imports are filtered out automatically.',
    ],
    table: null,
    showsTitleList: false,
  };
}

/** Alla nio kapitlen i ordning. `requirements` är nivåtabellen (shareds, identisk med databasen). */
export function buildChapters(
  rules: XpRules,
  requirements: readonly LevelRequirement[] = FALLBACK_LEVEL_REQUIREMENTS,
  stakes: Record<ChallengeTier, Stake> = observedStakes([]),
): Chapter[] {
  const chapters = [
    runChapter(rules), xpChapter(rules), streaksChapter(rules), levelsChapter(rules, requirements), titlesChapter(),
    challengesChapter(stakes), eventsChapter(), frodoChapter(), fairPlayChapter(),
  ];
  return chapters.map((chapter, index) => ({ ...chapter, num: String(index + 1).padStart(2, '0') }));
}

/** Granne till ett kapitel för "← förra / nästa →" — går runt i ändarna som prototypen. */
export function neighbours(chapters: readonly Chapter[], id: ChapterId): { prev: Chapter; next: Chapter; position: string } {
  const index = Math.max(0, chapters.findIndex((chapter) => chapter.id === id));
  return {
    prev: chapters[(index - 1 + chapters.length) % chapters.length],
    next: chapters[(index + 1) % chapters.length],
    position: `${index + 1} / ${chapters.length}`,
  };
}
