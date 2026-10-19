import { useAuth } from '@/providers/authContext';
import { createDefaultPageviewSender, type PageviewSender } from '@/shared/analytics/umamiPageviews';
import { usePageviewTracking } from '@/shared/analytics/usePageviewTracking';
import { isHandingOver } from './handoffState';
import { landingPageUrl } from './landingPageUrl';

// Sändaren skapas först när en visning ska skickas, aldrig under rendering: bygget renderar det här trädet i Node, där `window` inte finns.
// Under en överlämning till fullappen skickas ingenting (handoffState.ts).
const leanSender: PageviewSender = {
  send(url) {
    if (isHandingOver()) return;
    createDefaultPageviewSender().send(url);
  },
};

/**
 * Sidvisningarna för lean ingången (ADR 006, addendum 2026-10-19): samma hook, samma sändare och samma webbplats-id-grind som fullappen (App.tsx), så
 * `/`, `/login` och `/legal` räknas och utm_-attribueringen finns kvar när landing.html serveras på `/`. Renderar ingenting, så den förrenderade
 * markupen och hydreringen berörs inte. Ingen visning medan sessionen återställs (`loading`), och ingen för en överlämning: sessionstipset i head körs före
 * all JS och har aldrig laddat webbanalysen, och AppHandoff stänger sändaren (handoffState.ts).
 */
export function LandingPageviews(): null {
  const { loading } = useAuth();
  usePageviewTracking({ paused: loading, sender: leanSender, normalize: landingPageUrl });
  return null;
}
