/**
 * Lämnar lean landningen för fullappen med en full sidladdning (`replace`: landningen ligger inte kvar i historiken, Back går inte tillbaka till en
 * överlämning). Egen modul så att tester kan byta ut sidbytet; jsdom låter `window.location.replace` vara orörlig.
 */
export function leaveForApp(address: string): void {
  window.location.replace(address);
}
