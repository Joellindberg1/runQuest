import { usePreloadRunnerPopup } from '@/features/runner/usePreloadRunnerPopup';
import { TrackBackdrop } from '@/shared/components/TrackBackdrop';
import { AppHeader } from './AppHeader';
import { ShellOutlet } from './ShellOutlet';
import { SideNav } from './SideNav';
import { useRightNow } from './useRightNow';
import { useShellUser } from './useShellUser';

/** ≥ 1024 px: sidnav med "Right now"-panel + topbar + sida (Web Prototype). */
export function DesktopShell() {
  const user = useShellUser();
  const { items, hasOpenEvent } = useRightNow();
  // Profil-popupen finns bara på desktop (ADR 006 addendum 2026-10-26): mobilen hämtar den aldrig.
  usePreloadRunnerPopup();

  return (
    <div className="rq-shell rq-shell--desktop" data-shell="desktop">
      <TrackBackdrop />
      <SideNav rightNow={items} />
      <div className="rq-shell__col">
        <div className="rq-shell__top">
          <AppHeader variant="desktop" user={user} hasOpenEvent={hasOpenEvent} />
        </div>
        <main className="rq-shell__main">
          <ShellOutlet />
        </main>
      </div>
    </div>
  );
}
