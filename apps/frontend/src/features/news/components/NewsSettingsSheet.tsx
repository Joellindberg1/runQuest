import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { NotificationSettingsPanel } from '@/features/settings/components/NotificationSettingsPanel';
import { RQIcon } from '@/shared/components/icons';
import { NewsSettingsNote } from './NewsSettingsNote';

const ICON_GEAR = 17;

/**
 * Notisinställningarna på mobil: en ikonknapp i sidhuvudet öppnar ett bottenblad (samma `rq-sheet` som +New-sheeten; Radix Dialog ger
 * fokusfälla, Esc, klick utanför och fokus tillbaka till knappen). Knappen bär turens ankare `news-settings`.
 *
 * Panelen monteras av Radix först när bladet är öppet och försvinner när det stängs, så det finns aldrig mer än en instans
 * (och kolumnen på desktop monteras inte alls här). Panelens egen titel är dold i bladet — Dialog.Title bär rubriken.
 * Ändringarna sparas direkt, därför ingen guldknapp: "Done" är sekundär.
 */
export function NewsSettingsSheet() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className="rq-btn rq-btn--icon rq-news__settings" aria-label="Notification settings" data-tour="news-settings">
          <RQIcon name="settings" size={ICON_GEAR} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="rq-scrim" />
        <Dialog.Content className="rq-sheet rq-notify-sheet" aria-describedby={undefined}>
          <div className="rq-sheet__head">
            <Dialog.Title className="rq-sheet__title">Notifications</Dialog.Title>
            <Dialog.Close className="rq-sheet__close" aria-label="Close">✕</Dialog.Close>
          </div>
          <div className="rq-notify-sheet__body">
            <NotificationSettingsPanel headingLevel={3} defaultExpanded={false} showTotal={false} className="rq-notify--sheet" />
            <NewsSettingsNote />
          </div>
          <Dialog.Close className="rq-btn rq-btn--secondary rq-btn--block">Done</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
