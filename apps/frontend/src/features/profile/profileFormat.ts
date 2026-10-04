import { formatInt, formatKm, formatMultiplier } from '@/features/log/logFormat';

// Profilens formatterare. Talen delas med Log (en-GB-stil, tusentalsmellanrum). Månadsnamnen är egna:
// Intl:s förkortningar skiljer mellan ICU-versioner ("Sept").

export { formatInt, formatKm, formatMultiplier };

export const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "24 Aug" för en kalenderdag (YYYY-MM-DD). */
export function formatDay(isoDate: string): string {
  const [, month, day] = isoDate.slice(0, 10).split('-').map(Number);
  return `${day} ${SHORT_MONTHS[month - 1]}`;
}

/** "1 day" / "19 days". */
export function formatDays(count: number): string {
  return `${count} ${count === 1 ? 'day' : 'days'}`;
}
