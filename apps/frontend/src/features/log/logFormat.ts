import type { RQIconName } from '@/shared/components/icons';

// Rena formatterare för Log. Engelskt UI: egna månadsnamn (Intl:s förkortningar skiljer mellan ICU-versioner)
// och tal utan locale-beroende. `now` skickas alltid in så att allt går att testa med fasta klockslag.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

const MS_MINUTE = 60_000;
const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;

const NBSP = ' ';

/** "1 126" — heltal med tusentalsmellanrum som designen. */
export function formatInt(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** "8.0" — en decimal, punkt som decimaltecken. */
export function formatKm(km: number): string {
  return km.toFixed(1);
}

/** "1 June 2025" för en kalenderdag (YYYY-MM-DD). */
export function formatLongDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** "×1.4" — multiplikatorn i XP-uppställningen. */
export function formatTimes(multiplier: number): string {
  return `×${multiplier.toFixed(1)}`;
}

/** "1.4×" — multiplikatorn i historikcellen. */
export function formatMultiplier(multiplier: number): string {
  return `${multiplier.toFixed(1)}×`;
}

/** "32 min ago" · "3 h ago" · "2 d ago" · "just now". */
export function formatAgo(ms: number): string {
  if (ms < MS_MINUTE) return 'just now';
  if (ms < MS_HOUR) return `${Math.floor(ms / MS_MINUTE)} min ago`;
  if (ms < MS_DAY) return `${Math.floor(ms / MS_HOUR)} h ago`;
  return `${Math.floor(ms / MS_DAY)} d ago`;
}

/** "in 28 min" · "in 2 h" · "any moment" när tidpunkten redan passerats (nästa synk är inte körd än). */
export function formatIn(ms: number): string {
  if (ms < MS_MINUTE) return 'any moment';
  if (ms < MS_HOUR) return `in ${Math.floor(ms / MS_MINUTE)} min`;
  if (ms < MS_DAY) return `in ${Math.floor(ms / MS_HOUR)} h`;
  return `in ${Math.floor(ms / MS_DAY)} d`;
}

export interface WeatherLabel {
  label: string;
  /** Ikonen som finns i ikonsetet för vädret (sol, snö). Övriga väder visas som text. */
  icon: RQIconName | null;
  /** Nederbörd får sin etikett utskriven bredvid temperaturen. */
  precipitation: boolean;
}

/** WMO-väderkod (Open-Meteo) → etikett. Okänd kod → null (bara temperaturen visas). */
export function describeWeather(code: number): WeatherLabel | null {
  if (code === 0) return { label: 'Clear', icon: 'sun', precipitation: false };
  if (code === 1) return { label: 'Mainly clear', icon: 'sun', precipitation: false };
  if (code === 2) return { label: 'Partly cloudy', icon: null, precipitation: false };
  if (code === 3) return { label: 'Overcast', icon: null, precipitation: false };
  if (code === 45 || code === 48) return { label: 'Fog', icon: null, precipitation: false };
  if (code >= 51 && code <= 55) return { label: 'Drizzle', icon: null, precipitation: true };
  if (code >= 61 && code <= 65) return { label: 'Rain', icon: null, precipitation: true };
  if (code >= 71 && code <= 77) return { label: 'Snow', icon: 'snow', precipitation: true };
  if (code >= 80 && code <= 82) return { label: 'Rain showers', icon: null, precipitation: true };
  if (code === 85 || code === 86) return { label: 'Snow showers', icon: 'snow', precipitation: true };
  if (code >= 95 && code <= 99) return { label: 'Thunderstorm', icon: null, precipitation: true };
  return null;
}
