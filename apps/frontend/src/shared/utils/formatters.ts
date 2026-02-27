/** Extracts initials from a full name. "Joel Berg" → "JB" */
export function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase();
}

/** Formats XP values for display. 1500 → "1.5k", 1000000 → "1.0M" */
export function formatXPForDisplay(xp: number): string {
  const rounded = Math.round(xp * 10) / 10;
  if (rounded >= 1000000) return `${(rounded / 1000000).toFixed(1)}M`;
  if (rounded >= 1000) return `${(rounded / 1000).toFixed(1)}k`;
  return rounded.toFixed(1);
}

/** Formats a run date string to a readable short date. "2026-01-15" → "Thu, Jan 15, 2026" */
export function formatRunDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Formats a datetime string to HH:MM. "2026-01-15T14:30:00Z" → "14:30" */
export function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

/** Formats a connection date string to a locale date. null → "Unknown" */
export function formatConnectionDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Unknown';
  return new Date(dateStr).toLocaleDateString();
}
