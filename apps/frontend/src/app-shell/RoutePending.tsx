import { TrackLoader } from '@/shared/components/loaders/TrackLoader';
import './shell-pending.css';

/**
 * Appens enda laddningsvy (ADR 006, addendum 2026-10-19, punkt 11): stadion-ovalen mitt på skalets bakgrund. Den visas medan sessionen läses (App.tsx),
 * medan bredden är okänd (AppShell), som Suspense-fallback för route-chunkar utanför skalets egen Suspense, i lean landningens överlämning till appen
 * och förrenderad i `#root` i dist/index.html (prerender-landing). Stilen följer med komponenten, så varje ingång som ritar den får regeln utan hela skalets CSS.
 */
export function RoutePending() {
  return (
    <div className="rq-shell__pending">
      <TrackLoader size={64} label="Loading" />
    </div>
  );
}
