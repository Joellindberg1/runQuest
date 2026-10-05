import { TrackLoader } from '@/shared/components/loaders/TrackLoader';
import { DesktopShell } from './DesktopShell';
import { MobileShell } from './MobileShell';
import { useIsDesktop } from './useIsDesktop';
import './app-shell.css';

/**
 * Ett skal, två varianter, en brytpunkt (ADR 006 beslut 5). Exakt EN variant finns i DOM —
 * inte CSS-döljning — så data-tour-ankare är unika och hooks inte körs dubbelt.
 */
export function AppShell() {
  const isDesktop = useIsDesktop();

  if (isDesktop === undefined) {
    return (
      <div className="rq-shell__pending">
        <TrackLoader size={64} label="Loading" />
      </div>
    );
  }
  return isDesktop ? <DesktopShell /> : <MobileShell />;
}
