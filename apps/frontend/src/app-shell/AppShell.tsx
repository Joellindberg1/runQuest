import { useEffect } from 'react';
import { enableErrorReporting } from '@/shared/observability/errorReporting';
import { BadgeUpgradeHost } from '@/features/badges/components/BadgeUpgradeHost';
import { DesktopShell } from './DesktopShell';
import { MobileShell } from './MobileShell';
import { RoutePending } from './RoutePending';
import { useIsDesktop } from './useIsDesktop';
import './app-shell.css';

/**
 * Ett skal, två varianter, en brytpunkt (ADR 006 beslut 5). Exakt EN variant finns i DOM —
 * inte CSS-döljning — så data-tour-ankare är unika och hooks inte körs dubbelt.
 */
export function AppShell() {
  const isDesktop = useIsDesktop();

  // Felspårningen startar när det inloggade skalet monterar, aldrig på landningen (Sentry-koden hämtas som egen chunk).
  useEffect(() => {
    void enableErrorReporting();
  }, []);

  if (isDesktop === undefined) return <RoutePending />;
  return (
    <>
      {isDesktop ? <DesktopShell /> : <MobileShell />}
      <BadgeUpgradeHost />
    </>
  );
}
