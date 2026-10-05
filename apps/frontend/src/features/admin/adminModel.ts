import { formatInt } from '@/features/log/logFormat';
import type { AdminUser } from '@/shared/services/backendApi';
import type { AdminSettings } from './hooks/useAdminData';

// Admin-skärmens vymodeller: vilka XP-fält som finns och hur de grupperas, medlemsraden och en sista kontroll före Save.
// Ren logik — ingen DOM, ingen datahämtning. Servern validerar allt på riktigt (400 med skäl); kontrollen här fångar bara
// det som annars blir ett tomt fält som skickas som null.

export const ADMIN_VIEWS = ['xp', 'users', 'titles', 'security'] as const;
export type AdminView = (typeof ADMIN_VIEWS)[number];
export const DEFAULT_ADMIN_VIEW: AdminView = 'xp';

export type NumericSettingKey =
  | 'xpPerRun' | 'xpPerKm' | 'minKmForRun'
  | 'bonus5km' | 'bonus10km' | 'bonus15km' | 'bonus20km';

export interface XpFieldDef {
  key: NumericSettingKey | 'minRunDate';
  label: string;
  /** Heltal (XP), en decimal (km) eller ett datum. */
  kind: 'int' | 'decimal' | 'date';
  /** Falskt för det Save inte skickar: fältet visas men går inte att ändra (se XP_GROUPS). */
  editable: boolean;
}

export interface XpGroupDef {
  id: 'basic' | 'bonuses';
  title: string;
  note: string;
  fields: readonly XpFieldDef[];
}

/**
 * De två första korten i Web Prototypens Admin. Streak-trappan är det tredje (rader efter data, inte efter definition).
 * "Min run date" finns i prototypen och i gamla Admin, men Save skickar det aldrig (datumet är en konstant i appen) — det visas därför
 * skrivskyddat. Prototypens "Min km for streak" finns inte: streaken räknar varje runda oavsett distans (routes/runs.ts), och
 * min_run_distance styr bara bas-XP (calculateRunXP) — därav etiketten "Min km for base XP".
 */
export const XP_GROUPS: readonly XpGroupDef[] = [
  {
    id: 'basic',
    title: 'Basic XP',
    note: 'Applies to runs logged or synced after you save',
    fields: [
      { key: 'xpPerRun', label: 'XP per run', kind: 'int', editable: true },
      { key: 'xpPerKm', label: 'XP per km', kind: 'int', editable: true },
      { key: 'minKmForRun', label: 'Min km for base XP', kind: 'decimal', editable: true },
      { key: 'minRunDate', label: 'Min run date', kind: 'date', editable: false },
    ],
  },
  {
    id: 'bonuses',
    title: 'Distance bonuses',
    note: 'Awarded once per run at the highest tier reached',
    fields: [
      { key: 'bonus5km', label: '5 km bonus', kind: 'int', editable: true },
      { key: 'bonus10km', label: '10 km bonus', kind: 'int', editable: true },
      { key: 'bonus15km', label: '15 km bonus', kind: 'int', editable: true },
      { key: 'bonus20km', label: '20 km+ bonus', kind: 'int', editable: true },
    ],
  },
];

/** Backendens gräns för en multiplikator (numeric(3,2)): 1–9.99 med högst två decimaler. */
export const MULTIPLIER_MIN = 1;
export const MULTIPLIER_MAX = 9.99;

export function parseField(raw: string, kind: 'int' | 'decimal'): number {
  if (raw.trim() === '') return Number.NaN;
  return kind === 'int' ? parseInt(raw, 10) : parseFloat(raw);
}

/** Det som visas i fältet: ett tomt eller ogiltigt värde blir ett tomt fält, aldrig "NaN". */
export const fieldValue = (value: number): string | number => (Number.isFinite(value) ? value : '');

export interface MultiplierRow {
  days: number;
  multiplier: number;
  label: string;
}

/** Trappan i stigande dagordning (talnycklar sorteras redan så, men ordningen är ett krav, inte en tillfällighet). */
export function multiplierRows(multipliers: AdminSettings['multipliers']): MultiplierRow[] {
  return Object.entries(multipliers)
    .map(([days, multiplier]) => ({ days: Number(days), multiplier }))
    .sort((a, b) => a.days - b.days)
    .map(({ days, multiplier }) => ({ days, multiplier, label: `${days} ${days === 1 ? 'day' : 'days'}` }));
}

/** En multiplikator som servern tar emot: 1–9.99 med högst två decimaler (numeric(3,2)). */
export function isValidMultiplier(value: number): boolean {
  return Number.isFinite(value) && value >= MULTIPLIER_MIN && value <= MULTIPLIER_MAX && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

/**
 * Sista kontrollen före Save: inget ska skickas om något är ogiltigt. Spärren måste ligga FÖRE det första anropet — Save skriver
 * grundinställningarna först och trappan sen, så en trappa som servern avvisar i efterhand lämnar sparningen halv. Därför
 * kontrolleras både tomma fält och trappans intervall (1–9.99, högst två decimaler) här. Svarar med en mening eller null.
 */
export function findSettingsProblem(settings: AdminSettings): string | null {
  const numbers = [
    settings.xpPerRun, settings.xpPerKm, settings.minKmForRun,
    settings.bonus5km, settings.bonus10km, settings.bonus15km, settings.bonus20km,
    ...Object.values(settings.multipliers),
  ];
  if (!numbers.every(Number.isFinite)) return 'Every field needs a number before you can save';
  const bad = multiplierRows(settings.multipliers).find((row) => !isValidMultiplier(row.multiplier));
  return bad ? `The multiplier for ${bad.label} must be between ${MULTIPLIER_MIN} and ${MULTIPLIER_MAX}, with at most two decimals` : null;
}

/** "Level 24 · 5 539 XP · 159 runs · 8 streak" */
export function memberMeta(user: AdminUser): string {
  return `Level ${user.current_level} · ${formatInt(user.total_xp)} XP · ${formatInt(user.total_runs)} runs · ${user.current_streak} streak`;
}

export const memberCountText = (count: number): string => `${count} ${count === 1 ? 'member' : 'members'}`;
