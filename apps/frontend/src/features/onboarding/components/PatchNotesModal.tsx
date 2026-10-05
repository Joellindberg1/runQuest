// "What's new" — modal som visas när en annonserad post i changelog.json inte setts av användaren.
import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { CHANGE_KIND } from '@/features/changelog/changelogModel';
import type { PatchNote } from '@/features/changelog/changelogTypes';
import { RQIcon } from '@/shared/components/icons';
import '../whatsNew.css';

/** Väntan innan modalen visas — låter layouten sätta sig efter inloggning. */
const APPEAR_DELAY_MS = 500;
const ICON_ITEM = 15;

interface PatchNotesModalProps {
  note: PatchNote;
  /** Anropas när användaren stänger (Got it, ✕, Escape eller klick utanför) — då markeras posten som sedd. */
  onClose: () => void;
}

/**
 * Popupen "What's new": version + rubrik + punkterna ur posten, och EN guldknapp ("Got it", regel 3). Skalets delade lager
 * (`.rq-scrim`/`.rq-modal`) ger skuggan och mörkläggningen; Radix Dialog ger fokusfälla, Escape och role=dialog.
 * Ett fåtal punkter, enkel engelska — texterna kommer ur changelog.json, inte härifrån.
 */
export function PatchNotesModal({ note, onClose }: PatchNotesModalProps) {
  const [visible, setVisible] = useState(false);
  const gotItRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), APPEAR_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="rq-scrim" />
        {/* Fokus går till "Got it" (primärhandlingen), inte till ✕ — annars ramas hörnkorset in i guld som en andra guldknapp. */}
        <Dialog.Content className="rq-modal rq-whatsnew" aria-describedby={undefined} onOpenAutoFocus={(event) => { event.preventDefault(); gotItRef.current?.focus(); }}>
          <Dialog.Close className="rq-modal__close" aria-label="Close">✕</Dialog.Close>
          <header className="rq-whatsnew__head">
            <p className="rq-eyebrow rq-whatsnew__eyebrow">What&apos;s new · v{note.version}</p>
            <Dialog.Title className="rq-heading rq-whatsnew__title">{note.title}</Dialog.Title>
          </header>
          <div className="rq-whatsnew__body">
            <ul className="rq-hairgrid rq-whatsnew__list" aria-label={`What's new in version ${note.version}`}>
              {note.changes.map((change, index) => (
                <li key={`${index}-${change.description}`} className="rq-whatsnew__item" data-kind={change.type}>
                  <span className="rq-whatsnew__icon"><RQIcon name={CHANGE_KIND[change.type].icon} size={ICON_ITEM} /></span>
                  <p className="rq-whatsnew__text">{change.description}</p>
                </li>
              ))}
            </ul>
          </div>
          <footer className="rq-whatsnew__foot">
            <button ref={gotItRef} type="button" className="rq-btn rq-btn--primary rq-btn--block" onClick={onClose}>Got it</button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
