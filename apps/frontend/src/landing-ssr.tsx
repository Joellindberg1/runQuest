import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { RoutePending } from '@/app-shell/RoutePending';
import { StagingBanner } from '@/app-shell/StagingBanner';
import { LandingApp } from './landing-entry/LandingApp';
import { ServerRouter } from './landing-entry/ServerRouter';

// Serveringången för bygget (ADR 006, addendum 2026-10-19, punkt 2). Den byggs med `vite build --ssr` av scripts/prerender-landing.mjs, körs en gång i Node och
// kastas; ingen serverkod deployas. En landningsmodul som rör `window` på modulnivå fäller bygget här.

/** Landningens markup för `#root` i landing.html. Samma träd som hydrateLanding; här är stagingbannern en vanlig komponent, inte lazy. */
export function renderLanding(): string {
  return renderToString(<LandingApp Router={ServerRouter} StagingBanner={import.meta.env.VITE_APP_ENV === 'staging' ? StagingBanner : null} />);
}

/** Appens laddningsvy för `#root` i index.html: samma komponent som App.tsx, AppShell och överlämningen ritar. */
export function renderLoader(): string {
  return renderToStaticMarkup(<RoutePending />);
}
