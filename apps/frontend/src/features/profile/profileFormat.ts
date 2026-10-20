// Profilens formatterare. Talen, km och månadsnamnen ligger i shared/utils/format.

/** "1 day" / "19 days". */
export function formatDays(count: number): string {
  return `${count} ${count === 1 ? 'day' : 'days'}`;
}
