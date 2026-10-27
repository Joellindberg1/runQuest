import { summariseRunTime, type GroupRunHistoryItem } from '@runquest/shared';
import type { RQIconName } from '@/shared/components/icons';
import { getInitials } from '@/shared/utils/formatters';
import { formatDuration, formatInt, formatKm, formatMultiplier, formatPace, timePaceLabel } from '@/shared/utils/format';
import { describeWeather } from './logFormat';
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
  /** Löptid ("52:10", "1:09:40"). null = ingen användbar tid (manuell runda, utan moving_time, distans 0): kortet visar "—" med dold text "no time recorded". */
  time: string | null;
  /** Tempo per km ("5:13"), null i samma lägen som `time`. Enheten (" /km") sätter kortet. */
  pace: string | null;
  /** Skärmläsartexten för tid och tempo ("Time 52:10, pace 5:13 per kilometre"), null när `time` och `pace` är det. */
  timePaceLabel: string | null;
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

type TimePace = Pick<HistoryRow, 'time' | 'pace' | 'timePaceLabel'>;
const NO_TIME: TimePace = { time: null, pace: null, timePaceLabel: null };

/**
 * Tid och tempo för en runda. Tempot och "har rundan en användbar tid" avgörs av shared (`summariseRunTime`: tid och distans måste båda vara
 * ändliga och > 0); här finns ingen egen division. Formatfunktionerna tar bara giltiga tal, så null, NaN, 0 och ett tempo som avrundas till 0
 * grenar av före formateringen och ger tankstreck-läget, aldrig "NaN", "0:00" eller ett negativt tal.
 */
function timePaceOf(item: GroupRunHistoryItem): TimePace {
  const { total_seconds: seconds, pace_sec_per_km: pace, runs_with_time: runsWithTime } = summariseRunTime([
    { moving_time: item.moving_time, distance: Number(item.distance) },
  ]);
  if (runsWithTime === 0 || pace === null || pace <= 0) return NO_TIME;
  return { time: formatDuration(seconds), pace: formatPace(pace), timePaceLabel: timePaceLabel(seconds, pace) };
}

export function buildHistoryRow(item: GroupRunHistoryItem, meId: string | undefined): HistoryRow {
  return {
    id: item.id,
    userId: item.user_id,
    name: item.user_name,
    initials: getInitials(item.user_name),
    pictureUrl: item.user_profile_picture ?? null,
    date: item.date.slice(0, 10),
    surface: item.is_treadmill === null ? null : item.is_treadmill ? 'treadmill' : 'outdoor',
    weather: weatherOf(item),
    source: sourceOf(item.source),
    km: formatKm(Number(item.distance)),
    ...timePaceOf(item),
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

/**
 * Raderna för alla hämtade sidor. Sidorna är offsetsidor: läggs en runda till (eller tas en bort) mellan två hämtningar glider fönstret och en runda kommer på
 * två sidor. Därför dedupas på run-id innan något byggs (första förekomsten vinner, serverns ordning behålls); annars ritas rundan två gånger med samma React-nyckel.
 */
export function buildHistoryRows(items: readonly GroupRunHistoryItem[], meId: string | undefined): HistoryRow[] {
  const seen = new Set<string>();
  const rows: HistoryRow[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    rows.push(buildHistoryRow(item, meId));
  }
  return rows;
}
