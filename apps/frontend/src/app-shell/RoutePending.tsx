import { TrackLoader } from '@/shared/components/loaders/TrackLoader';
import './shell-pending.css';

/**
 * Laddningsvyns oval är tre gånger så stor som den var (ägarens beslut, "så att den syns tydligare"): 64 px bred blev 192 px, i rutan 217,4 x 167,3 px med lutningen.
 * Storleken sätts här och inte i TrackLoader, så övriga platser (paneler, knappar, Week/Streaks) behåller sina egna storlekar. Banlinjen och prickarna följer storleken
 * (track-geometry), så ovalen ser likadan ut, bara större.
 */
const LOADING_VIEW_SIZE = 192;

/**
 * Appens enda laddningsvy (ADR 006, addendum 2026-10-19, punkt 11): stadion-ovalen mitt på skalets bakgrund. Den visas medan sessionen läses (App.tsx),
 * medan bredden är okänd (AppShell), som Suspense-fallback för route-chunkar utanför skalets egen Suspense, i lean landningens överlämning till appen
 * och förrenderad i `#root` i dist/index.html (prerender-landing). Stilen följer med komponenten, så varje ingång som ritar den får regeln utan hela skalets CSS.
 */
export function RoutePending() {
  return (
    <div className="rq-shell__pending">
      <TrackLoader size={LOADING_VIEW_SIZE} label="Loading" />
    </div>
  );
}
