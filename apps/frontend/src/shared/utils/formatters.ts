/** Extracts initials from a full name. "Joel Berg" → "JB" */
export function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase();
}
