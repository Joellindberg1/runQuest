import type { ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';

/**
 * Webbläsarens router för både fullappen och den lean landningen. Router 7 lägger varje adressbyte i `React.startTransition` om inget annat sägs; v6 gjorde inte det,
 * och appen bygger på det: `AvatarMenu` byter adress och nollställer användaren i samma händelse och räknar med att båda syns i samma rendering. I en övergång
 * ritas användaren först (med den gamla, skyddade adressen kvar) och utloggningen hamnar på `/login?next=` i stället för på Landing (App.logout.test.tsx).
 */
export function AppBrowserRouter({ children }: { children: ReactNode }) {
  return <BrowserRouter useTransitions={false}>{children}</BrowserRouter>;
}
