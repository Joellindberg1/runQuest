import type { RQIconName } from '@/shared/components/icons';
import { MONTHS_LONG } from '@/shared/utils/format';

// Rena formatterare för Log. Engelskt UI: tal, km, multiplikator och "tid sedan" ligger i shared/utils/format.

/** "1 June 2025" för en kalenderdag (YYYY-MM-DD). */
export function formatLongDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${day} ${MONTHS_LONG[month - 1]} ${year}`;
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
