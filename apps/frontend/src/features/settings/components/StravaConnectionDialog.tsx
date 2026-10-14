import { useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { ConnectionAction } from '../hooks/useStravaActions';
import {
  CHOOSE_LEAD,
  CHOOSE_TITLE,
  CONFIRM_TITLE,
  DISCONNECT_CHOICE,
  KEEP_CONNECTION_ACTION,
  PAUSE_CHOICE,
  buildDisconnectConfirmation,
} from '../stravaConnectionCopy';

/** Steget dialogen visar: valet (Pause sync / Disconnect…) eller den separata bekräftelsen av bortkopplingen. `null` = stängd. */
export type ConnectionStep = 'choose' | 'confirm' | null;

interface StravaConnectionDialogProps {
  step: ConnectionStep;
  /** Antalet Stravarundor appen känner till, eller `null` så länge rundorna inte är lästa (då står ingen siffra på knappen). */
  stravaRuns: number | null;
  busy: ConnectionAction | null;
  /** Felet från senaste försöket; står i dialogens egen alert-region och dialogen förblir öppen. */
  error: string | null;
  onPause: () => void;
  onChooseDisconnect: () => void;
  onConfirmDisconnect: () => void;
  /** Avbrutet utan anrop (Cancel, Keep my connection, ✕, Esc). */
  onCancel: () => void;
  /** Radix flyttar fokus när dialogen stängs; kortet bestämmer vart (knappen som öppnade den, eller rubriken efter en lyckad åtgärd). */
  onCloseAutoFocus: (event: Event) => void;
}

const PAUSE_TITLE_ID = 'settings-strava-choice-pause';
const DISCONNECT_TITLE_ID = 'settings-strava-choice-disconnect';

/** Rubrikraden: "Strava"-märket är källmärket (Stravas orange har den enda tillåtna platsen här), inte en status. */
function DialogHead({ title, disabled }: { title: string; disabled: boolean }) {
  return (
    <div className="rq-settings-dialog__head">
      <span className="rq-chip rq-chip--strava">Strava</span>
      <Dialog.Title className="rq-heading rq-settings-dialog__title">{title}</Dialog.Title>
      <Dialog.Close className="rq-settings-dialog__close" aria-label="Close" disabled={disabled}>✕</Dialog.Close>
    </div>
  );
}

/** Alla fel i dialogen står i EN permanent alert-region (finns i DOM:en före texten, annars annonseras den inte pålitligt). */
function DialogAlert({ error }: { error: string | null }) {
  return (
    <div role="alert" aria-label="Strava connection error" className="rq-settings-dialog__alert">
      {error && <p className="rq-form-notice" data-tone="error">{error}</p>}
    </div>
  );
}

/**
 * Pause or disconnect (ADR 010 beslut 7.6): två dialoger efter varandra, aldrig en tredje. Valet har en mening per val; bekräftelsen av
 * bortkopplingen är en egen `alertdialog` med hela förklaringen, "cannot be undone" och antalet rundor som raderas. Radix Dialog bär båda
 * (AlertDialog-paketet är inte installerat): fokusfälla, Esc och aria-modal kommer därifrån, rollen och beskrivningen sätts här.
 *
 * Två rötter i stället för ett byte av innehåll, så att bekräftelsen får en egen rubrik, roll och beskrivning som skärmläsaren möter på nytt,
 * och så att första fokus (Keep my connection) sätts av Radix vid öppningen. Dialogerna är kontrollerade av kortet och har ingen Trigger,
 * så fokus tillbaka styrs av `onCloseAutoFocus`. Ingen guld i dialogen: röd står aldrig bredvid guld.
 */
export function StravaConnectionDialog({ step, stravaRuns, busy, error, onPause, onChooseDisconnect, onConfirmDisconnect, onCancel, onCloseAutoFocus }: StravaConnectionDialogProps) {
  const keepRef = useRef<HTMLButtonElement>(null);
  const confirmation = buildDisconnectConfirmation(stravaRuns);
  const working = busy === 'pause' || busy === 'disconnect';
  // Ett pågående anrop avbryts inte av Esc, ✕ eller klick utanför: dialogen stängs när svaret kommit.
  const closeUnlessBusy = (open: boolean) => { if (!open && !working) onCancel(); };

  return (
    <>
      <Dialog.Root open={step === 'choose'} onOpenChange={closeUnlessBusy}>
        <Dialog.Portal>
          <Dialog.Overlay className="rq-scrim" />
          <Dialog.Content
            className="rq-settings-dialog"
            onCloseAutoFocus={onCloseAutoFocus}
            onEscapeKeyDown={(event) => { if (working) event.preventDefault(); }}
            onInteractOutside={(event) => { if (working) event.preventDefault(); }}
          >
            <DialogHead title={CHOOSE_TITLE} disabled={working} />
            <Dialog.Description className="rq-settings-dialog__lead">{CHOOSE_LEAD}</Dialog.Description>
            <section className="rq-card rq-card--edge rq-settings-choice" aria-labelledby={PAUSE_TITLE_ID}>
              <h3 id={PAUSE_TITLE_ID} className="rq-settings-choice__title">{PAUSE_CHOICE.title}</h3>
              <p className="rq-settings-choice__text">{PAUSE_CHOICE.text}</p>
              <button type="button" className="rq-btn rq-btn--ghost rq-settings-choice__action" disabled={working} onClick={onPause}>
                {busy === 'pause' ? 'Pausing…' : PAUSE_CHOICE.action}
              </button>
            </section>
            <section className="rq-card rq-card--edge rq-settings-choice" data-tone="down" aria-labelledby={DISCONNECT_TITLE_ID}>
              <h3 id={DISCONNECT_TITLE_ID} className="rq-settings-choice__title">{DISCONNECT_CHOICE.title}</h3>
              <p className="rq-settings-choice__text">{DISCONNECT_CHOICE.text}</p>
              <button type="button" className="rq-btn rq-btn--danger rq-settings-choice__action" disabled={working} onClick={onChooseDisconnect}>
                {DISCONNECT_CHOICE.action}
              </button>
            </section>
            <DialogAlert error={step === 'choose' ? error : null} />
            <div className="rq-settings-dialog__actions">
              <button type="button" className="rq-btn rq-btn--ghost" disabled={working} onClick={onCancel}>Cancel</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={step === 'confirm'} onOpenChange={closeUnlessBusy}>
        <Dialog.Portal>
          <Dialog.Overlay className="rq-scrim" />
          <Dialog.Content
            role="alertdialog"
            className="rq-settings-dialog"
            data-tone="down"
            onOpenAutoFocus={(event) => { event.preventDefault(); keepRef.current?.focus(); }}
            onCloseAutoFocus={onCloseAutoFocus}
            onEscapeKeyDown={(event) => { if (working) event.preventDefault(); }}
            // En destruktiv bekräftelse stängs inte av ett klick bredvid (som en AlertDialog): bara av ett uttryckligt val eller Esc.
            onInteractOutside={(event) => event.preventDefault()}
          >
            <DialogHead title={CONFIRM_TITLE} disabled={working} />
            <Dialog.Description asChild>
              <div className="rq-settings-dialog__body">
                <ul className="rq-settings-effects" aria-label="What happens">
                  {confirmation.happens.map((line) => (
                    <li key={line} className="rq-settings-effect" data-tone="down">
                      <span className="rq-dot" aria-hidden="true" />
                      {line}
                    </li>
                  ))}
                </ul>
                <ul className="rq-settings-effects" aria-label="What stays">
                  {confirmation.stays.map((line) => (
                    <li key={line} className="rq-settings-effect" data-tone="up">
                      <span className="rq-dot" aria-hidden="true" />
                      {line}
                    </li>
                  ))}
                </ul>
                <p className="rq-settings-warning">{confirmation.warning}</p>
              </div>
            </Dialog.Description>
            <DialogAlert error={step === 'confirm' ? error : null} />
            <div className="rq-settings-dialog__actions">
              <button ref={keepRef} type="button" className="rq-btn rq-btn--ghost" disabled={working} onClick={onCancel}>{KEEP_CONNECTION_ACTION}</button>
              <button type="button" className="rq-btn rq-btn--danger-fill" disabled={working} onClick={onConfirmDisconnect}>
                {busy === 'disconnect' ? 'Disconnecting…' : confirmation.action}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
