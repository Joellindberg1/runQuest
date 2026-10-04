import { Link } from 'react-router-dom';
import { paths } from '@/paths';
import { RQIcon } from '@/shared/components/icons';
import { useGroupName } from '@/shared/hooks/useGroupName';
import { AvatarMenu } from './AvatarMenu';
import { ThemeSwitch } from './ThemeSwitch';
import type { ShellUser } from './useShellUser';

const ICON_HEADER = 17;
const ICON_BELL = 21;

interface AppHeaderProps {
  variant: 'mobile' | 'desktop';
  user: ShellUser | null;
  /** Prick på kalenderikonen när ett event är öppet. */
  hasOpenEvent: boolean;
}

// Mållopps-raden under gruppnamnet utelämnas: datan finns inte än (ADR 008/mållopp senare).
// Klockan går till /news utan oläst-räknare — den kommer i inkrement 9.
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
        <Link to={paths.news} className="rq-header__action" aria-label="Pack news" data-tour="header-news">
          <RQIcon name="bell" size={variant === 'desktop' ? ICON_BELL : ICON_HEADER} />
        </Link>
        <AvatarMenu user={user} variant={variant} />
      </div>
    </header>
  );
}
