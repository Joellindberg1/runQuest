import { Link } from 'react-router-dom';
import { paths } from '@/paths';
import { RQIcon } from '@/shared/components/icons';
import { useGroupName } from '@/shared/hooks/useGroupName';
import { AvatarMenu } from './AvatarMenu';
import { NotificationsPopover } from './NotificationsPopover';
import { ThemeSwitch } from './ThemeSwitch';
import type { ShellUser } from './useShellUser';

const ICON_HEADER = 17;

interface AppHeaderProps {
  variant: 'mobile' | 'desktop';
  user: ShellUser | null;
  /** Prick på kalenderikonen när ett event är öppet. */
  hasOpenEvent: boolean;
}

// Mållopps-raden under gruppnamnet utelämnas: datan finns inte än (ADR 008/mållopp senare).
// Klockan är NotificationsPopover: oläst-räknare + de fem senaste ur Pack News, "See all" → /news (ADR 006 beslut 4, ADR 008).
export function AppHeader({ variant, user, hasOpenEvent }: AppHeaderProps) {
  const groupName = useGroupName();

  return (
    <header className={`rq-header rq-header--${variant}`}>
      <div className="rq-header__group">{groupName}</div>
      <div className="rq-header__actions">
        {variant === 'desktop' && <ThemeSwitch />}
        {variant === 'mobile' && (
          <Link to={paths.events} className="rq-header__action" aria-label="Events" data-tour="header-events">
            <RQIcon name="calendar" size={ICON_HEADER} />
            {hasOpenEvent && <span className="rq-dot rq-dot--live rq-header__badge" aria-label="Event open now" role="img" />}
          </Link>
        )}
        <NotificationsPopover variant={variant} />
        <AvatarMenu user={user} variant={variant} />
      </div>
    </header>
  );
}
