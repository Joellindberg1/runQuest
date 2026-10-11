import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Popover from '@radix-ui/react-popover';
import { useAuth } from '@/providers/authContext';
import { paths } from '@/paths';
import { RQIcon, type RQIconName } from '@/shared/components/icons';
import { changelog } from '@/features/changelog/changelogData';
import { latestRelease } from '@/features/changelog/changelogModel';
import type { ShellUser } from './useShellUser';

const ICON_MENU = 15;
const MENU_TOUR_ANCHOR = 'header-avatar';

interface MenuItemSpec {
  key: string;
  label: string;
  icon: RQIconName;
  hint?: string;
  to?: string;
  danger?: boolean;
  onSelect?: () => void;
}

interface AvatarMenuProps {
  user: ShellUser | null;
  /** Mobil lägger Playbook + Feature & Version här; på desktop ligger de i sidnavigeringen. */
  variant: 'mobile' | 'desktop';
}

function subtitleOf(user: ShellUser | null): string {
  const parts: string[] = [];
  if (user?.level != null) parts.push(`Level ${user.level}`);
  if (user?.rank != null) parts.push(`#${user.rank} in the pack`);
  return parts.join(' · ');
}

export function AvatarMenu({ user, variant }: AvatarMenuProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { isAdmin, logout } = useAuth();

  // Utloggning → Landing, utan dialog och utan `next` (ADR 006 beslut 1, addendum). Navigeringen och logout() ligger i samma händelse och batchas
  // till EN rendering (React 18): adressen är redan `/` när användaren blivit null, så RequireAuth hinner aldrig skicka till /login?next=. Ordningen
  // är avsiktlig — kastas användaren först, och en rendering hinner emellan, ersätter RequireAuth adressen med /login?next=<sidan du loggade ut från>.
  // (Ett 401 mitt i sessionen är medvetet något annat: där vill vi ha dialogen med `next`, så man kommer tillbaka dit man var.)
  const logOutToLanding = () => {
    navigate(paths.landing, { replace: true });
    logout();
  };

  const items: MenuItemSpec[] = [
    ...(variant === 'mobile'
      ? [
          { key: 'playbook', label: 'Playbook', icon: 'book', to: paths.playbook } as MenuItemSpec,
          { key: 'features', label: 'Feature & Version', icon: 'sparkles', to: paths.features, hint: latestRelease(changelog.releases)?.version } as MenuItemSpec,
        ]
      : []),
    { key: 'settings', label: 'Settings', icon: 'settings', to: paths.settings },
    ...(isAdmin ? [{ key: 'admin', label: 'Admin', icon: 'shield', to: paths.admin, hint: variant === 'mobile' ? 'admin' : undefined } as MenuItemSpec] : []),
    { key: 'logout', label: 'Log out', icon: 'logout', danger: true, onSelect: logOutToLanding },
  ];

  const select = (item: MenuItemSpec) => {
    setOpen(false);
    if (item.onSelect) item.onSelect();
    if (item.to) navigate(item.to);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="rq-avatar rq-header__avatar"
          aria-label={user ? `Account menu for ${user.name}` : 'Account menu'}
          data-tour={MENU_TOUR_ANCHOR}
        >
          {user?.pictureUrl ? <img src={user.pictureUrl} alt="" /> : (user?.initials ?? '?')}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className={`rq-popover rq-menu${variant === 'desktop' ? ' rq-popover--gold' : ''}`}
        >
          <div className="rq-menu__head">
            <div className="rq-menu__name">{user?.name ?? ''}</div>
            <div className="rq-menu__sub">{subtitleOf(user)}</div>
          </div>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`rq-menu__item${item.danger ? ' rq-menu__item--danger' : ''}`}
              onClick={() => select(item)}
            >
              <RQIcon name={item.icon} size={ICON_MENU} />
              <span className="rq-menu__label">{item.label}</span>
              {item.hint && <span className="rq-menu__hint">{item.hint}</span>}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
