import { FALLBACK_LEVEL_REQUIREMENTS, calculateCompleteRunXP, calculateRunXP, type LevelRequirement } from '@runquest/shared';
import { MIN_RUN_DATE } from '@/constants/appConstants';
import { DEFAULT_STAKES } from '@/features/challenges/rulesModel';
import { TIERS, stakeOf, tierLabel } from '@/features/challenges/duelsFormat';
import { formatInt, formatKm, formatLongDate } from '@/features/log/logFormat';
import type { XpRules } from '@/features/log/xpPreviewModel';
import { ALL_WAYPOINTS, JOURNEY_END_KM } from '@/features/profile/frodoModel';
import type { RQIconName } from '@/shared/components/icons';
import { MAX_DISPLAYED } from '@/features/titles/titlesModel';

// Playbook-skärmens kapitel: spelets regler som text, med siffrorna ur GET /config/xp (bas-XP, XP/km, distansbonusar,
// streak-trappan) i stället för hårdkodade. Nivåtabellen är shareds (enda hemmet, identisk med level_requirements i prod),
// titlarna kommer ur databasen (titleRules.ts). Det som inte finns i någon konfiguration (eventens fönster, insatserna
// per utmaningsnivå) är redaktionell text — samma som den gamla sidan. Ren logik — ingen DOM.

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
  const minKm = formatKm(rules.settings.min_run_distance);
  return {
    id: 'run', icon: 'plus', label: 'What counts as a run', title: 'What counts as a run',
    lead: `A run counts from ${minKm} km. Anything shorter is a walk with ambition and earns nothing.`,
    paras: [
      'Strava runs arrive by themselves every 30 minutes — only activities of type Run, from the last 7 days on each sync, with duplicates filtered out. Treadmill runs are tagged automatically when Strava flags them, and weather is fetched for every outdoor run with GPS.',
      `You can also log a run by hand, back to ${formatLongDate(MIN_RUN_DATE)} and never into the future. Manual runs have no GPS, so no weather and no elevation. The XP is exactly the same.`,
    ],
    table: {
      label: 'The basics',
      rows: [
        { label: 'Minimum distance', value: `${minKm} km` },
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
      `A ${EXAMPLE_SHORT_KM} km run is ${short.baseXP} + ${short.kmXP} + ${short.distanceBonus} = ${short.totalXP} XP before the streak. A ${EXAMPLE_LONG_KM} km run is ${long.baseXP} + ${long.kmXP} + ${long.distanceBonus} = ${long.totalXP} XP. The distance bonus is paid once per run, at the highest tier reached, and the streak never touches it.`,
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
    ? `Consecutive days with a qualifying run build a multiplier from 1.0× up to ${times(top.multiplier)}.`
    : 'Consecutive days with a qualifying run build a multiplier on your XP.';
  const paras = [
    'A streak counts unique days: running twice in one day still counts as one. Miss a whole day and you start again at 1.0× — no grace days, no freezes and no way to buy it back.',
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
      'Each title belongs to whoever has the best value for its metric right now, and the holders update after every synced run. Some titles have to be unlocked first: until someone passes the threshold the title sits empty, with the best attempt on show.',
      `You can show up to ${MAX_DISPLAYED} titles on your leaderboard card. Treadmill runs count toward XP and levels but are left out of titles that need outdoor running, like the elevation titles.`,
    ],
    table: null,
    showsTitleList: true,
  };
}

function challengesChapter(): Omit<Chapter, 'num'> {
  return {
    id: 'challenges', icon: 'swords', label: 'Challenges', title: 'Challenges',
    lead: 'One token, one 1v1 challenge. You pick the tier and who to take on — the metric and the length are drawn at random for that tier.',
    paras: [
      'Tokens are earned at certain levels and spent to send a challenge. Once the opponent accepts, the duel starts at 00:00 the next day and runs to 23:59 on its last day. The best performer wins a temporary XP boost; the loser takes a penalty.',
      'The boost is added to your streak multiplier on every run until it runs out. A draw changes nothing.',
    ],
    table: {
      label: 'The stakes',
      rows: TIERS.flatMap((tier) => {
        const stake = stakeOf(DEFAULT_STAKES[tier]);
        return [
          { label: `${tierLabel(tier)} · win`, value: stake.win },
          { label: `${tierLabel(tier)} · lose`, value: stake.lose },
        ];
      }),
    },
    showsTitleList: false,
  };
}

function eventsChapter(): Omit<Chapter, 'num'> {
  return {
    id: 'events', icon: 'calendar', label: 'Events', title: 'Events',
    lead: 'Events open on a schedule or on the weather. Finish inside the window and you get the XP — no ranking, everyone who qualifies wins.',
    paras: [
      'Weekly competitions are the exception: they run Monday to Sunday, rank everyone on total kilometres or elevation, and pay out on Sunday evening — 40, 30 and 20 XP for the top three.',
      'Storm Chaser only appears when tomorrow’s forecast shows at least 3 hours of rain, drizzle, thunder or gusts above 12 m/s. The app checks every evening at 19:00.',
      'Event XP is tracked separately from run XP. It counts toward your total and your level, but it is not part of the per-run breakdown.',
    ],
    table: {
      label: 'Participation events',
      rows: [
        { label: 'Morgonrunda', note: '06:00–10:00 daily · min 3 km', value: '+25' },
        { label: 'Kvällsrunda', note: '18:00–22:00 daily · min 3 km', value: '+25' },
        { label: '5K Friday', note: 'All Friday · min 5 km', value: '+25' },
        { label: 'Hangover Run', note: 'Saturday and Sunday · min 3 km', value: '+30' },
        { label: 'Storm Chaser', note: 'Weather only · min 5 km', value: '+40' },
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
      'Duplicate imports are filtered automatically. Anything that looks impossible can be discussed in the group chat, which is where every dispute has always been settled anyway.',
    ],
    table: null,
    showsTitleList: false,
  };
}

/** Alla nio kapitlen i ordning. `requirements` är nivåtabellen (shareds, identisk med databasen). */
export function buildChapters(rules: XpRules, requirements: readonly LevelRequirement[] = FALLBACK_LEVEL_REQUIREMENTS): Chapter[] {
  const chapters = [
    runChapter(rules), xpChapter(rules), streaksChapter(rules), levelsChapter(rules, requirements), titlesChapter(),
    challengesChapter(), eventsChapter(), frodoChapter(), fairPlayChapter(),
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
