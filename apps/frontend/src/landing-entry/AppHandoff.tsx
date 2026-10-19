import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { RoutePending } from '@/app-shell/RoutePending';
import { beginHandoff } from './handoffState';
import { leaveForApp } from './leaveForApp';

/**
 * Överlämningen till fullappen (ADR 006, addendum 2026-10-19, punkt 1 och 11). Renderar appens laddningsvy i samma rendering som det som låg här
 * försvinner, så containern aldrig är tom, och laddar sedan om sidan på `to` (Caddy ger då index.html, som målar samma vy före JS).
 * Effekten körs efter första målningen: laddningsvyn står alltså redan på skärmen när det gamla dokumentet börjar lämnas.
 */
export function AppHandoff({ to }: { to: string }) {
  useEffect(() => {
    // Stänger sidvisningarna innan sidan lämnas: fullappen räknar sin egen första sida (handoffState.ts).
    const endHandoff = beginHandoff();
    leaveForApp(to);
    return endHandoff;
  }, [to]);
  return <RoutePending />;
}

/** Routen `*`: en adress den lean landningen inte äger lämnas över som den är. Aldrig `/` (den matchar landningens egen route), alltså ingen loop. */
export function UnknownAddressHandoff() {
  const { pathname, search, hash } = useLocation();
  return <AppHandoff to={`${pathname}${search}${hash}`} />;
}
