import { lazy } from 'react';

// Inloggningsdialogen (Radix Dialog, formuläret, login.css och skalets överlagerlager) ligger inte i första besökets kod: den är en egen chunk som hämtas när
// besökaren visar avsikt mot Sign in (LandingIndex) eller öppnar /login direkt (ADR 006, addendum 2026-10-19, punkt 8). LoginDialogChunk ger den lagret.
const loadLoginDialog = () => import('./LoginDialogChunk').then((module) => ({ default: module.LoginDialog }));

export const LazyLoginDialog = lazy(loadLoginDialog);

/**
 * Hämtar chunken i förväg. Misslyckas hämtningen är det inte ett fel ännu: dialogen försöker igen när den renderas och då tar Suspense och
 * staleChunkReload hand om det. Därför sväljs avvisningen här.
 */
export function prefetchLoginDialog(): void {
  void loadLoginDialog().catch(() => undefined);
}
