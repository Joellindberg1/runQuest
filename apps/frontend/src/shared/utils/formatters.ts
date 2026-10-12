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
