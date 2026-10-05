import type { GroupRunHistoryItem } from '@runquest/shared';
import type { RQIconName } from '@/shared/components/icons';
import { getInitials } from '@/shared/utils/formatters';
import { describeWeather, formatInt, formatKm, formatMultiplier } from './logFormat';
import type { Tone } from './xpPreviewModel';

// Group history: gruppens rundor som kort. Ren logik — ingen DOM, ingen datahämtning.

/** Rundor per sida (GET /runs/group-history?limit=). Prototypen visar fem kort + "Show more"; tio ger färre rundturer. */
export const HISTORY_PAGE_SIZE = 10;

export type SurfaceKind = 'outdoor' | 'treadmill';

export interface HistoryCell {
  key: 'streak' | 'multiplier' | 'base' | 'km' | 'bonus';
  value: string;
  label: string;
  tone: Tone;
}

export interface HistoryRow {
  id: string;
  userId: string;
  name: string;
  initials: string;
  pictureUrl: string | null;
  /** YYYY-MM-DD, som prototypen. */
  date: string;
  /** null = okänt (äldre manuella rundor) — ingen chip i stället för en gissning. */
  surface: SurfaceKind | null;
  weather: { icon: RQIconName | null; temperature: string; label: string | null } | null;
  source: { label: string; strava: boolean };
  km: string;
  xp: string;
  cells: HistoryCell[];
  /** Min egen runda: guldkant (samma markering som "jag" i Events/Duels). */
  isMe: boolean;
}

function sourceOf(raw: string | undefined): HistoryRow['source'] {
  const source = (raw ?? 'manual').toLowerCase();
  if (source === 'strava') return { label: 'Strava', strava: true };
  return { label: source.charAt(0).toUpperCase() + source.slice(1), strava: false };
}

function weatherOf(item: GroupRunHistoryItem): HistoryRow['weather'] {
  if (item.weather_code === null || item.temperature_c === null) return null;
  const described = describeWeather(item.weather_code);
  return {
    icon: described?.icon ?? null,
    temperature: `${Math.round(item.temperature_c)} °C`,
    // Klart väder förklarar ikonen; nederbörd och övrigt skrivs ut.
    label: described && (!described.icon || described.precipitation) ? described.label : null,
  };
}

export function buildHistoryRow(item: GroupRunHistoryItem, meId: string | undefined): HistoryRow {
  return {
    id: item.id,
    userId: item.user_id,
    name: item.user_name,
    initials: getInitials(item.user_name).slice(0, 2),
    pictureUrl: item.user_profile_picture ?? null,
    date: item.date.slice(0, 10),
    surface: item.is_treadmill === null ? null : item.is_treadmill ? 'treadmill' : 'outdoor',
    weather: weatherOf(item),
    source: sourceOf(item.source),
    km: formatKm(Number(item.distance)),
    xp: formatInt(item.xp_gained),
    cells: [
      { key: 'streak', value: String(item.streak_day), label: 'streak day', tone: 'default' },
      { key: 'multiplier', value: formatMultiplier(Number(item.multiplier)), label: 'multiplier', tone: Number(item.multiplier) > 1 ? 'gold' : 'muted' },
      { key: 'base', value: String(item.base_xp), label: 'base xp', tone: 'default' },
      { key: 'km', value: String(item.km_xp), label: 'km xp', tone: 'default' },
      { key: 'bonus', value: item.distance_bonus > 0 ? `+${item.distance_bonus}` : '0', label: 'bonus', tone: item.distance_bonus > 0 ? 'up' : 'muted' },
    ],
    isMe: item.user_id === meId,
  };
}

export function buildHistoryRows(items: readonly GroupRunHistoryItem[], meId: string | undefined): HistoryRow[] {
  return items.map((item) => buildHistoryRow(item, meId));
}
