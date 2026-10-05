import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { NewsPopoverPanel } from '@/features/news/components/NewsPopoverPanel';
import { useNewsUnreadCount } from '@/features/news/hooks/useNewsQueries';
import { badgeText } from '@/features/news/newsModel';
import { useAuth } from '@/providers/authContext';
import { RQIcon } from '@/shared/components/icons';

const ICON_HEADER = 17;
const ICON_BELL = 21;
const COLLISION_PADDING = 12;

interface NotificationsPopoverProps {
  variant: 'mobile' | 'desktop';
}

/**
 * Klockan i headern (ADR 006 beslut 4): öppnar en popover med de fem senaste ur Pack News och en oläst-räknare ur samma flöde
 * (EN query-definition i features/news — skärmen och popovern delar cache och hämtintervall). "See all pack news" går till /news.
 * Mobil har en ✕ (prototypen), desktop stänger med Esc eller klick utanför.
 */
export function NotificationsPopover({ variant }: NotificationsPopoverProps) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const unread = useNewsUnreadCount(!!user);
  const badge = badgeText(unread);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="rq-header__action"
          aria-label={unread > 0 ? `Pack news, ${unread} unread` : 'Pack news'}
          data-tour="header-news"
        >
          <RQIcon name="bell" size={variant === 'desktop' ? ICON_BELL : ICON_HEADER} />
          {badge && <span className="rq-news-badge rq-header__badge" aria-hidden="true">{badge}</span>}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={COLLISION_PADDING}
          aria-label="Pack news"
          className="rq-popover rq-popover--gold rq-news-pop"
        >
          <NewsPopoverPanel onClose={() => setOpen(false)} showClose={variant === 'mobile'} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
