import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { BadgePopupEntry } from '../badgeModel';
import { tierKey } from './badgeTier';
import { BadgeChip } from './BadgeChip';
import { BadgeEmblem } from './BadgeEmblem';
import '../badges.css';

/** Efter att en ny post blivit aktuell ignoreras avfärdande så här länge: dubbelklick och en hållen Enter/Escape ska inte avfärda nästa badge osedd. */
export const DISMISS_GUARD_MS = 350;

/** En hållen tangent (repeat) får aldrig avfärda: den skulle gå vidare till nästa post i kön. preventDefault hindrar Enter från att bli ett nytt klick. */
const blockRepeat = (event: KeyboardEvent) => { if (event.repeat) event.preventDefault(); };

export interface BadgeUpgradeDialogProps {
  entry: BadgePopupEntry;
  /** Platsen i kön (1-baserad) och antalet vid öppning — värden från värden, som fryser dem. total 1 = ingen kö. */
  position: number;
  total: number;
  /** "Got it", ✕, Escape och klick på scrimmen: samma sak — den här serien är sedd och kön går vidare. */
  onDismiss: () => void;
  /** "Skip all": alla i kön är sedda. Knappen visas bara när fler väntar efter den här. */
  onSkipAll: () => void;
}

/**
 * Uppgraderingspopupen (spec F6, Council 4, 19–21): en serie i taget. Radix Dialog ger role=dialog, fokusfälla, Escape och scrim-klick; fokus flyttas
 * till "Got it" vid öppning och popupen lämnar tillbaka det till det som hade fokus före den. Ingen belöning och ingen "View badges": texten lovar
 * ingenting. Emblemet får `key={serie+tier}` — tändningen är CSS-animation som bara startar när elementet monteras, så nästa badge i kön måste vara ett nytt element.
 */
export function BadgeUpgradeDialog({ entry, position, total, onDismiss, onSkipAll }: BadgeUpgradeDialogProps) {
  const gotItRef = useRef<HTMLButtonElement>(null);
  // Elementet som hade fokus när popupen öppnades (den öppnas av sig själv, så Radix har ingen Trigger att lämna tillbaka fokus till). Läses vid första renderingen, före Radix flyttar fokus.
  const [returnFocusTo] = useState(() => document.activeElement);
  const evolved = entry.kind === 'evolved' && entry.fromTier !== null;
  const queued = total > 1;
  const emblemKey = `${entry.series}-${entry.tier}`;
  // När den aktuella posten visades (0 = före första effekten). Sätts om för varje ny post.
  const shownAt = useRef(0);
  useEffect(() => { shownAt.current = Date.now(); }, [emblemKey]);
  const guarded = (action: () => void) => { if (Date.now() - shownAt.current >= DISMISS_GUARD_MS) action(); };

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) guarded(onDismiss); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="rq-scrim" />
        {/* Fokus går till "Got it" (primärhandlingen), inte till ✕ — annars ramas hörnkorset in. aria-modal sätts uttryckligen (Council 19). */}
        <Dialog.Content
          className="rq-modal rq-badge-popup"
          aria-modal="true"
          onEscapeKeyDown={(event) => { if (event.repeat) event.preventDefault(); }}
          onOpenAutoFocus={(event) => { event.preventDefault(); gotItRef.current?.focus(); }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returnFocusTo instanceof HTMLElement && returnFocusTo !== document.body && returnFocusTo.isConnected) returnFocusTo.focus({ preventScroll: true });
          }}
        >
          <Dialog.Close className="rq-modal__close rq-badge-popup__close" aria-label="Close" onKeyDown={blockRepeat} onClick={(event) => { if (event.detail > 1) event.preventDefault(); }}>✕</Dialog.Close>
          <p className="rq-eyebrow rq-badge-popup__eyebrow">
            {evolved ? 'Badge evolved' : 'Badge earned'}
            {queued && <> · <span aria-live="polite">{position} of {total}</span></>}
          </p>
          <div className="rq-badge-popup__emblems">
            {evolved && (
              <>
                <BadgeEmblem key={`from-${emblemKey}`} series={entry.series} tier={entry.fromTier} size="sm" decorative />
                <span className="rq-badge-popup__arrow" aria-hidden="true">→</span>
              </>
            )}
            <BadgeEmblem key={emblemKey} series={entry.series} tier={entry.tier} size="lg" ignite decorative />
          </div>
          <Dialog.Title className="rq-heading rq-badge-popup__title">{entry.name}</Dialog.Title>
          {evolved && <p className="rq-badge-popup__tierline" data-tier={tierKey(entry.tier)}>{entry.fromTierName} → {entry.tierName}</p>}
          <BadgeChip tier={entry.tier} />
          <Dialog.Description className="rq-badge-popup__req">{entry.requirement}</Dialog.Description>
          {entry.flavor && <p className="rq-badge-popup__flavor">“{entry.flavor}”</p>}
          {entry.heldBy && <p className="rq-badge-popup__held">{entry.heldBy}</p>}
          <div className="rq-badge-popup__actions">
            <button ref={gotItRef} type="button" className="rq-btn rq-btn--primary rq-badge-popup__btn" onKeyDown={blockRepeat} onClick={(event) => { if (event.detail < 2) guarded(onDismiss); }}>Got it</button>
            {queued && position < total && (
              <button type="button" className="rq-btn rq-btn--sm rq-btn--ghost rq-badge-popup__btn" onKeyDown={blockRepeat} onClick={(event) => { if (event.detail < 2) guarded(onSkipAll); }}>Skip all</button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
