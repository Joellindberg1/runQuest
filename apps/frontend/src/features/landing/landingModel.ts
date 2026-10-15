import {
  DEFAULT_ADMIN_SETTINGS, DEFAULT_STREAK_MULTIPLIERS, calculateRunXP, calculateStreakMultiplier, stravaPollIntervalLabel,
  type AdminSettings, type PublicStatsData, type StreakMultiplier,
} from '@runquest/shared';
import type { User } from '@runquest/types';
import { deltaView, type DeltaView } from '@/features/leaderboard/boardFormat';
import { formatInt } from '@/features/log/logFormat';
import { leaderboardUtils } from '@/shared/utils/leaderboardUtils';

// Landingens vymodell. Exempelflocken är påhittad (features/leaderboard/previewUsers) och spelreglerna läses ur shared; de enda
// riktiga talen är de tre i sifferraden (GET /public/stats, hooks/usePublicStats). Ren logik: rendering ligger i komponenterna,
// rörelsen i landing.css.

// ── Ankare ────────────────────────────────────────────────────────────────

export const FILM_ID = 'film';
export const HOW_IT_WORKS_ID = 'how-it-works';
export const FEATURES_ID = 'features';
export const WAITLIST_ID = 'waitlist';

/** Headerns ankarlänkar (bara desktop). Etiketterna är designens; ankaret är det de hoppar till. */
export const LANDING_NAV: readonly { label: string; id: string }[] = [
  { label: 'The game', id: FILM_ID },
  { label: 'XP & levels', id: HOW_IT_WORKS_ID },
  { label: 'Titles', id: FEATURES_ID },
];

/** Hjältens ingress: den långa är designens desktoptext (ordagrant), den korta mobilens. */
export const LEAD_DESKTOP =
  'Every run you log earns XP. XP becomes levels, levels become titles, and titles become an argument that lasts all season. Strava syncs your runs automatically — the rest is between you and your friends.';
export const LEAD_MOBILE = 'Every run earns XP. XP becomes levels, levels become titles. Strava syncs the runs — you bring the arguing.';

// ── Sifferraden ───────────────────────────────────────────────────────────

/** Visas i talets ställe medan svaret laddas. */
export const STAT_PLACEHOLDER = '—';

export type StatKey = 'km' | 'runners' | 'challenges';

export interface StatView {
  key: StatKey;
  tone: 'gold' | 'plain';
  /** Talet med tusentalsmellanrum, eller platshållaren. */
  value: string;
  /** Etiketten; ental får singular ("1 runner"). */
  label: string;
}

const singular = (count: number, one: string, many: string): string => (count === 1 ? one : many);

/** De tre talen i designens ordning: km (guld), löpare, utmaningar. Utan svar (laddar) står platshållaren i stället för talen. */
export function buildStatViews(data: PublicStatsData | undefined): StatView[] {
  const text = (count: number | undefined): string => (data && count !== undefined ? formatInt(count) : STAT_PLACEHOLDER);
  return [
    { key: 'km', tone: 'gold', value: text(data?.km), label: 'km logged' },
    { key: 'runners', tone: 'plain', value: text(data?.runners), label: data ? singular(data.runners, 'runner', 'runners') : 'runners' },
    { key: 'challenges', tone: 'plain', value: text(data?.challenges), label: data ? singular(data.challenges, 'challenge', 'challenges') : 'challenges' },
  ];
}

// ── Previewkortet ─────────────────────────────────────────────────────────

/** Namnet på exempelflocken i previewkortets rubrik. */
export const PREVIEW_PACK_NAME = 'Sample pack';

export const PREVIEW_SIZE = 5;
const STAGGER_SECONDS = 0.1;

export type PreviewTone = '1' | '2' | '3' | 'rest';

export interface PreviewRow {
  id: string;
  rank: number;
  tone: PreviewTone;
  /** Förnamnet — previewn visar aldrig hela namn (anonymiserad). */
  name: string;
  xp: string;
  /** Stapelns längd: XP relativt etta, i procent. */
  pct: number;
  delay: string;
  delta: DeltaView;
}

const toneOf = (rank: number): PreviewTone => (rank === 1 ? '1' : rank === 2 ? '2' : rank === 3 ? '3' : 'rest');

/** Topp fem ur exempelflocken: samma sortering som Board (nivå, sedan XP) och samma rank-pilar. */
export function buildPreviewRows(users: User[], rankDeltaByUser: Record<string, number | null>): PreviewRow[] {
  const sorted = leaderboardUtils.filterAndSortUsers(users).slice(0, PREVIEW_SIZE);
  const topXp = sorted[0]?.total_xp ?? 0;

  return sorted.map((user) => {
    const rank = leaderboardUtils.getUserPosition(user, sorted);
    return {
      id: user.id,
      rank,
      tone: toneOf(rank),
      name: user.name.split(' ')[0],
      xp: formatInt(user.total_xp),
      pct: topXp > 0 ? Math.round((user.total_xp / topXp) * 100) : 0,
      delay: `${(rank * STAGGER_SECONDS).toFixed(1)}s`,
      delta: deltaView(rankDeltaByUser[user.id]),
    };
  });
}

export interface PreviewNote {
  title: string;
  body: string;
}

/** De tre förklaringarna bredvid previewkortet (desktop). Den tredje ersätter designens nedräkning, som saknas i kortet. */
export const PREVIEW_NOTES: readonly PreviewNote[] = [
  { title: 'Rank changes show up', body: 'Arrows mark who moved since last week, so a lead never sits quietly.' },
  { title: 'Levels, not just totals', body: 'The bar is progress into the current level — the newest runner can still level faster than the leader.' },
  { title: 'Events give easy XP', body: 'Recurring events open on a schedule; join one and the XP lands on the board.' },
];

// ── How it works ──────────────────────────────────────────────────────────

export interface HowStep {
  num: string;
  title: string;
  body: string;
}

/** Distansbonusarna i calculateRunXP ligger på fasta trösklar (5/10/15/20 km); beloppen är inställningar. */
const BONUS_THRESHOLDS_KM = [5, 10, 15, 20] as const;

const joinList = (items: readonly number[]): string => `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/**
 * De fyra stegen. XP- och streak-siffrorna kommer ur shared-definitionerna (ADR 004), inte ur en egen kopia, så texten
 * följer spelets standardregler. Landingen läser inte admin-inställningarna, så en ändring där syns inte här
 * (öppet antagande i docs/open-assumptions.md).
 */
export function buildHowItWorks(
  settings: AdminSettings = DEFAULT_ADMIN_SETTINGS,
  streakLadder: readonly StreakMultiplier[] = DEFAULT_STREAK_MULTIPLIERS,
): HowStep[] {
  const first = streakLadder[0];
  const top = streakLadder[streakLadder.length - 1];

  return [
    { num: '01', title: 'Log the run', body: 'Connect Strava and runs appear by themselves. No Strava? Type distance and date.' },
    {
      num: '02',
      title: 'Earn XP',
      body: `Base ${settings.base_xp} plus ${settings.xp_per_km} per km, with bonus XP at ${joinList(BONUS_THRESHOLDS_KM)} km. Same formula for everyone.`,
    },
    {
      num: '03',
      title: 'Keep the streak',
      body: first && top
        ? `Run on consecutive days and a multiplier kicks in from day ${first.days} (×${first.multiplier.toFixed(1)}), climbing to ×${top.multiplier.toFixed(1)} at day ${top.days}. Miss a day and it starts over.`
        : 'Run on consecutive days and your XP multiplier grows. Miss a day and it starts over.',
    },
    { num: '04', title: 'Take the title', body: 'Longest run, longest streak, most km. Titles change hands the moment someone beats you.' },
  ];
}

// ── XP-formeln ────────────────────────────────────────────────────────────

/** Exempelrundan i rutan "A 10 km run today". */
const EXAMPLE_RUN_KM = 10;

export interface XpFormula {
  /** De fyra termerna i ordning; operatorerna mellan dem (+ + ×) ritar komponenten. */
  terms: [string, string, string, string];
  /** Exempelrundan utan streak: antal km och XP enligt calculateRunXP. */
  example: { km: number; xp: number };
  /** Hela formeln som en mening för skärmläsare. */
  spoken: string;
}

/** Formeln med talen ur shared. Streak-intervallet börjar på det en rund utan streak ger (1.0) och slutar på trappans översta steg. */
export function buildXpFormula(
  settings: AdminSettings = DEFAULT_ADMIN_SETTINGS,
  streakLadder: readonly StreakMultiplier[] = DEFAULT_STREAK_MULTIPLIERS,
): XpFormula {
  const low = calculateStreakMultiplier(0, [...streakLadder]).toFixed(1);
  const high = (streakLadder[streakLadder.length - 1]?.multiplier ?? calculateStreakMultiplier(0, [])).toFixed(1);
  return {
    terms: [`Base ${settings.base_xp}`, `km × ${settings.xp_per_km}`, 'Distance bonus', `Streak ${low}–${high}×`],
    example: { km: EXAMPLE_RUN_KM, xp: calculateRunXP(EXAMPLE_RUN_KM, settings).totalXP },
    spoken: `Base ${settings.base_xp} plus ${settings.xp_per_km} per km plus distance bonus, times a streak multiplier from ${low} to ${high}`,
  };
}

// ── Funktionsrutnätet ─────────────────────────────────────────────────────

export interface FeatureCard {
  tag: string;
  title: string;
  body: string;
}

/**
 * De sex korten. Synkintervallet kommer ur shared/rules.ts (STRAVA_POLL_INTERVAL_HOURS via stravaPollIntervalLabel); Playbook och
 * Settings läser samma etikett. Eventexemplen är seedade mallar (migration 017: Morgonrunda, 5K Friday, Hangover Run).
 */
export function buildFeatures(): FeatureCard[] {
  return [
    { tag: '01', title: 'Leaderboard', body: 'Podium for the top three, ranked list below, live rank changes.' },
    { tag: '02', title: 'Titles', body: 'Held, not awarded. Every title has a current holder and a challenger.' },
    { tag: '03', title: 'Challenges', body: '1v1 across three tiers. Spend a token, pick a metric, winner gets an XP boost.' },
    { tag: '04', title: 'Events', body: 'Recurring challenges that open on a schedule — morning runs, 5K Fridays, hangover runs.' },
    { tag: '05', title: 'Strava sync', body: `Runs arrive from Strava as you save them, with a backup check every ${stravaPollIntervalLabel()}. Nothing to log by hand.` },
    { tag: '06', title: 'The journey', body: 'Your total distance mapped as a route with checkpoints, so the km add up to something.' },
  ];
}

// ── Arenabanan ────────────────────────────────────────────────────────────

/** Banans rityta (user units). Samma stadionoval som Loaders. */
export const ARENA_VIEWBOX = '0 0 1400 760';

export interface ArenaLane {
  /** 1 = innersta banan (kortast varv), högre = längre ut. */
  lane: number;
  path: string;
  /** Linjens guldstyrka (0–1): innerbanan är tydligast. */
  alpha: number;
}

export interface ArenaPop {
  label: string;
  x: number;
  /** Textens startläge; CSS lyfter den uppåt när löparen passerar mållinjen. */
  y: number;
}

export interface ArenaRunner {
  /** Löparens nummer: CSS knyter varv, startförskjutning och färg till det. */
  n: number;
  lane: number;
  radius: number;
  pop: ArenaPop | null;
}

export interface ArenaGeometry {
  tiltDeg: number;
  lanes: readonly ArenaLane[];
  runners: readonly ArenaRunner[];
  finish: { x: number; y1: number; y2: number };
  /** `middle`: texten centreras på x. `start`: texten börjar vid x (desktop, intill mållinjen). */
  popAnchor: 'start' | 'middle';
  /** Mobilens oval står nästan lodrätt, så texten vrids tillbaka och läses upprätt. Desktops lutning (−31°) läses som den är. */
  popUpright: boolean;
}

const lanePath = (inset: number): string => {
  const r = 150 + inset;
  const top = 380 - r;
  const bottom = 380 + r;
  return `M340 ${top} H1060 A${r} ${r} 0 0 1 1060 ${bottom} H340 A${r} ${r} 0 0 1 340 ${top} Z`;
};

const lanesOf = (insets: readonly number[], alphas: readonly number[]): ArenaLane[] =>
  insets.map((inset, index) => ({ lane: index + 1, path: lanePath(inset), alpha: alphas[index] }));

/**
 * Mobil (App Prototypen): tre banor, tre löpare i olika takt (guld · silver · brons) och en "+50 XP"-pop för guldlöparen.
 * Desktop (Landing-designen): fem banor, sex löpare som var och en poppar sitt XP-belopp vid mållinjen. Varv och färger sitter i CSS.
 */
export const ARENA: { mobile: ArenaGeometry; desktop: ArenaGeometry } = {
  mobile: {
    tiltDeg: -72,
    lanes: lanesOf([0, 40, 80], [0.34, 0.22, 0.16]),
    runners: [
      { n: 1, lane: 1, radius: 34, pop: { label: '+50 XP', x: 700, y: 440 } },
      { n: 2, lane: 2, radius: 30, pop: null },
      { n: 3, lane: 3, radius: 27, pop: null },
    ],
    finish: { x: 700, y1: 520, y2: 620 },
    popAnchor: 'middle',
    popUpright: true,
  },
  desktop: {
    tiltDeg: -31,
    lanes: lanesOf([0, 26, 52, 78, 104], [0.34, 0.27, 0.22, 0.18, 0.15]),
    runners: [
      { n: 1, lane: 1, radius: 9, pop: { label: '+50 XP', x: 716, y: 522 } },
      { n: 2, lane: 2, radius: 8, pop: { label: '+35 XP', x: 716, y: 548 } },
      { n: 3, lane: 3, radius: 8, pop: { label: '+25 XP', x: 716, y: 574 } },
      { n: 4, lane: 4, radius: 7.5, pop: { label: '+107 XP', x: 716, y: 600 } },
      { n: 5, lane: 5, radius: 7, pop: { label: '+30 XP', x: 716, y: 626 } },
      { n: 6, lane: 2, radius: 7, pop: { label: '+19 XP', x: 716, y: 548 } },
    ],
    finish: { x: 700, y1: 524, y2: 640 },
    popAnchor: 'start',
    popUpright: false,
  },
};
