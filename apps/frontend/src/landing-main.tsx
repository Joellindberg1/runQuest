import { hydrateLanding } from './landing-entry/hydrateLanding';
import './index.css';
import { installStaleChunkReload } from '@/shared/utils/staleChunkReload';

// Landningens lean ingång (ADR 006, addendum 2026-10-19): landing.html serveras för exakt `/` med landningen förrenderad i #root. Hela appen
// (main.tsx, routes.tsx, skalet, sidorna, touren) laddas inte här; en inloggning eller en annan adress lämnar över till den med en full sidladdning.
installStaleChunkReload(window, () => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
});

hydrateLanding(document.getElementById('root')!);
