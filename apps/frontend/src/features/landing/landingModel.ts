import { DEFAULT_ADMIN_SETTINGS, DEFAULT_STREAK_MULTIPLIERS, type AdminSettings, type StreakMultiplier } from '@runquest/shared';
import type { User } from '@runquest/types';
import { deltaView, type DeltaView } from '@/features/leaderboard/boardFormat';
import { formatInt } from '@/features/log/logFormat';
import { leaderboardUtils } from '@/shared/utils/leaderboardUtils';

// Landingens vymodell. Ägarbeslut 4: ALL data här är hårdskriven exempeldata — ingen endpoint, inga anrop.
// Ren logik: rendering ligger i komponenterna, rörelsen i landing.css.

/** Hero-märket "N packs running" (påhittat). */
export const PACKS_RUNNING = 14;

/** Aggregaten under hjälten (påhittade; räknas upp en gång när sidan visas). */
export const LANDING_STATS = [
  { key: 'km', label: 'km', value: 128_430, tone: 'gold' },
  { key: 'runs', label: 'runs', value: 9_412, tone: 'plain' },
  { key: 'xp', label: 'XP', value: 1_284_600, tone: 'plain' },
] as const;

export type LandingStat = (typeof LANDING_STATS)[number];

/** Uppräkningens längd (prototypen: 1.7 s, ease-out cubic). */
export const COUNT_UP_MS = 1700;

/** 0 → 1 över `durationMs`, avrundat mot slutet; negativ tid och längd 0 ger de rimliga ytterlägena. */
export function countUpProgress(elapsedMs: number, durationMs: number = COUNT_UP_MS): number {
  if (durationMs <= 0) return 1;
  const linear = Math.min(1, Math.max(0, elapsedMs / durationMs));
  return 1 - (1 - linear) ** 3;
}

/** Visat tal vid en given framsteg (0–1): heltal, sista steget är exakt målet. */
export function countUpValue(target: number, progress: number): number {
  return progress >= 1 ? target : Math.round(target * Math.max(0, progress));
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
 * följer spelets standardregler. Landingen gör inga anrop, så en ändring i admin-inställningarna syns inte här
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

// ── Arenabanan ────────────────────────────────────────────────────────────

/** Banans rityta (user units). Samma stadionoval som Loaders, tre banor. */
export const ARENA_VIEWBOX = '0 0 1400 760';

export interface ArenaLane {
  /** 1 = guld (innersta banan, kortast varv), 2 = silver, 3 = brons (yttersta). */
  lane: 1 | 2 | 3;
  path: string;
  runnerRadius: number;
}

const lanePath = (inset: number): string => {
  const r = 150 + inset;
  const top = 380 - r;
  const bottom = 380 + r;
  return `M340 ${top} H1060 A${r} ${r} 0 0 1 1060 ${bottom} H340 A${r} ${r} 0 0 1 340 ${top} Z`;
};

export const ARENA_LANES: readonly ArenaLane[] = [
  { lane: 1, path: lanePath(0), runnerRadius: 34 },
  { lane: 2, path: lanePath(40), runnerRadius: 30 },
  { lane: 3, path: lanePath(80), runnerRadius: 27 },
];

/** Mållinjen tvärs över banorna, och "+50 XP"-poppen (i banans mitt) som visas när guldlöparen passerar den. */
export const ARENA_FINISH = { x: 700, y1: 520, y2: 620 } as const;
/** Ovalens vridning (grader): EN källa — ArenaTrack sätter den som CSS-variabel på SVG:n och roterar "+50 XP"-texten tillbaka med samma värde. */
export const ARENA_TILT_DEG = -72;
export const ARENA_XP_POP = { x: 700, y: 440, label: '+50 XP' } as const;
