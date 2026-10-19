import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// Appens laddningsvy har EN definition (ADR 006, addendum 2026-10-19, punkt 11): App.tsx medan sessionen läses, AppShell medan bredden är okänd, Suspense i
// routerträdet, lean landningens överlämning och den förrenderade index.html delar alla RoutePending. Komponenten ersätts här av en markör, så testet fäller
// om en av platserna ritar sin egen kopia av vyn.
vi.mock('@/app-shell/RoutePending', () => ({ RoutePending: () => <p>the shared loading view</p> }));

import App from '@/App';
import { AppShell } from './AppShell';

describe('the loading view is defined once', () => {
  it('AppShell shows the shared loading view while the viewport width is unknown', () => {
    // Ingen matchMedia i jsdom och inga effekter i en serverrendering: useIsDesktop är odefinierad.
    expect(renderToStaticMarkup(<AppShell />)).toBe('<p>the shared loading view</p>');
  });

  it('App shows the shared loading view while the session is read', () => {
    // AuthProvider börjar i loading och släpper den i en effekt, som en serverrendering aldrig kör.
    expect(renderToStaticMarkup(<App />)).toContain('<p>the shared loading view</p>');
  });
});
