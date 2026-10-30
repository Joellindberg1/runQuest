/** Under två medlemmar finns inget att jämföra sig mot (ADR 007 addendum 2026-10-26: klienten döljer fliken). */
export const MIN_MEMBERS_FOR_POSITION = 2;

/**
 * Om Position-fliken visas. Antalet kommer ur `users-with-runs`, som Board väntar på ändå, så fliken kan döljas utan att positionssvaret hämtas för den skull.
 * Samma regel gäller profilens flik (profilen läser den härifrån).
 */
export function showPositionTab(memberCount: number): boolean {
  return memberCount >= MIN_MEMBERS_FOR_POSITION;
}
