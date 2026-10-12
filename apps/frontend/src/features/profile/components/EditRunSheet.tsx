import { useRef, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { Run } from '@runquest/types';
import { MIN_RUN_DATE } from '@/constants/appConstants';
import { RUN_DELETED_RECALCULATING, RUN_SAVED_RECALCULATING, RunWrittenError } from '@/features/runs/runEffects';
import { useDeleteRun, useUpdateRun } from '../hooks/useRunChanges';
import { formatKm } from '../profileFormat';
import { STRAVA_DELETE_HINT, buildUpdate, buildXpParts, deleteNotice, editFormFor, isDirty, isStravaRun, updateNotice, validateEdit, type EditForm } from '../profileModel';

/** RUN-139: Strava är sanningskällan för distans och datum — en Strava-runda visas skrivskyddad, utan Save. */
const STRAVA_READ_ONLY_HINT = "Synced from Strava. Distance and date come from Strava and can't be changed here.";

interface EditRunSheetProps {
  run: Run;
  /** Stockholm-dagen: datumfältets övre gräns. */
  today: string;
  onClose: () => void;
  /** Rundan är sparad/raderad och data omhämtad: skärmen visar bekräftelsen och rutan stängs. */
  onDone: (notice: string) => void;
  /**
   * Rutan är kontrollerad och har ingen Dialog.Trigger, så Radix har ingen knapp att återföra fokus till (det faller till body).
   * Skärmen bestämmer: efter en sparad/raderad runda (`done`) går fokus till bekräftelsen, annars tillbaka till Edit-knappen.
   */
  onRestoreFocus: (done: boolean) => void;
}

/**
 * Redigera eller radera en av mina rundor: bottensheet på mobil, centrerad dialog på desktop (samma markup, olika mått via
 * tokens). EN guldknapp (Save changes); Delete är en röd hårlinje och bekräftas i ett eget steg där den fyllda röda knappen
 * finns — oåterkalleligt. Serverns fel visas i rutan (permanent live-region), valideringsfel bredvid fältet. Rutan stängs
 * först när servern svarat och omhämtningen är klar; efter det visar skärmen bekräftelsen. Monteras bara medan den är öppen.
 * En Strava-runda (RUN-139) visas skrivskyddad: distans och datum som text, en rad om att den synkats från Strava, ingen
 * Save (PUT redigerar bara just de två fälten) och Delete fortsatt spärrad. Ett 409 från servern (gammal klient/kapplöpning)
 * hamnar som vanligt i felregionen.
 */
export function EditRunSheet({ run, today, onClose, onDone, onRestoreFocus }: EditRunSheetProps) {
  const doneRef = useRef(false);
  const [form, setForm] = useState<EditForm>(() => editFormFor(run));
  const [attempted, setAttempted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const distanceRef = useRef<HTMLInputElement>(null);
  const update = useUpdateRun();
  const remove = useDeleteRun();

  const pending = update.isPending || remove.isPending;
  const errors = attempted ? validateEdit(form, today, run) : {};
  const dirty = isDirty(form, run);
  const runDate = editFormFor(run).date;
  const fromStrava = isStravaRun(run);

  const edit = (patch: Partial<EditForm>) => {
    setForm((previous) => ({ ...previous, ...patch }));
    setServerError(null);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setServerError(null);
    const built = buildUpdate(form, today, run);
    if (!built.ok) {
      setAttempted(true);
      if (built.errors.date) dateRef.current?.focus();
      else distanceRef.current?.focus();
      return;
    }
    try {
      const updated = await update.mutateAsync({ run, update: built.update });
      doneRef.current = true;
      onDone(updateNotice(updated));
    } catch (error) {
      if (error instanceof RunWrittenError) {
        // Ändringen är skriven och cachen omhämtad; rutan stängs så att ingen sparar om samma sak.
        doneRef.current = true;
        onDone(RUN_SAVED_RECALCULATING);
        return;
      }
      setServerError(error instanceof Error ? error.message : 'Failed to update the run');
    }
  };

  const destroy = async () => {
    if (pending) return;
    setServerError(null);
    try {
      await remove.mutateAsync(run);
      doneRef.current = true;
      onDone(deleteNotice(run));
    } catch (error) {
      if (error instanceof RunWrittenError) {
        doneRef.current = true;
        onDone(RUN_DELETED_RECALCULATING);
        return;
      }
      setServerError(error instanceof Error ? error.message : 'Failed to delete the run');
    }
  };

  const xpSection = (
    <section aria-label="What this run earned">
      <p className="rq-label rq-profile-sub">What this run earned</p>
      <dl className="rq-hairgrid rq-profile-sheet__xp">
        {buildXpParts(run).map((part) => (
          <div key={part.key} className="rq-profile-sheet__xp-row" data-total={part.key === 'total' || undefined}>
            <dt>{part.label}</dt>
            <dd>{part.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="rq-scrim" />
        <Dialog.Content
          className="rq-profile-sheet"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onRestoreFocus(doneRef.current);
          }}
        >
          <header className="rq-profile-sheet__head">
            <div className="rq-profile-sheet__id">
              <Dialog.Title className="rq-profile-sheet__title">{confirming ? 'Delete run' : fromStrava ? 'Run details' : 'Edit run'}</Dialog.Title>
              <p className="rq-profile-sheet__sub">{runDate} · {formatKm(run.distance)} km</p>
            </div>
            <Dialog.Close className="rq-sheet__close" aria-label="Close" disabled={pending}>✕</Dialog.Close>
          </header>

          {confirming ? (
            <>
              <div className="rq-profile-sheet__body">
                <p className="rq-profile-sheet__confirm">
                  Delete this {formatKm(run.distance)} km run from {runDate}? Your streak and XP are recalculated from that day on. This can&apos;t be undone.
                </p>
                <p role="alert" className="rq-profile-sheet__error">{serverError}</p>
              </div>
              <footer className="rq-profile-sheet__foot">
                <button type="button" className="rq-btn rq-btn--danger-fill" disabled={pending} onClick={() => void destroy()}>
                  {remove.isPending ? 'Deleting…' : 'Delete run'}
                </button>
                <button type="button" className="rq-btn rq-btn--ghost" disabled={pending} onClick={() => { setConfirming(false); setServerError(null); }}>
                  Keep run
                </button>
              </footer>
            </>
          ) : fromStrava ? (
            <div className="rq-profile-sheet__form">
              <div className="rq-profile-sheet__body">
                {/* Strava är sanningskällan (RUN-139): distans och datum visas men går inte att ändra, och servern avvisar PUT med 409. */}
                <section aria-label="Date and distance">
                  <dl className="rq-hairgrid rq-profile-sheet__xp">
                    <div className="rq-profile-sheet__xp-row">
                      <dt>Date</dt>
                      <dd>{runDate}</dd>
                    </div>
                    <div className="rq-profile-sheet__xp-row">
                      <dt>Distance</dt>
                      <dd>{formatKm(run.distance)} km</dd>
                    </div>
                  </dl>
                </section>

                {xpSection}

                <p className="rq-profile-sheet__hint">{STRAVA_READ_ONLY_HINT}</p>
                {/* Synlig förklaring för den som inte kan hovra (touch); skärmläsare får samma text i knappen. */}
                <p className="rq-profile-sheet__hint" aria-hidden="true">{STRAVA_DELETE_HINT}.</p>
                <p role="alert" className="rq-profile-sheet__error">{serverError}</p>
              </div>

              <footer className="rq-profile-sheet__foot">
                <Dialog.Close className="rq-btn rq-btn--ghost" disabled={pending}>Close</Dialog.Close>
                <button type="button" className="rq-btn rq-btn--danger" disabled title={STRAVA_DELETE_HINT}>
                  Delete run
                  <span className="sr-only"> — {STRAVA_DELETE_HINT}</span>
                </button>
              </footer>
            </div>
          ) : (
            <form noValidate onSubmit={(event) => void save(event)} aria-label="Edit run" className="rq-profile-sheet__form">
              <div className="rq-profile-sheet__body">
                <div className="rq-profile-sheet__fields">
                  <div className="rq-profile-field">
                    <label htmlFor="profile-edit-date" className="rq-profile-label">Date</label>
                    <input
                      ref={dateRef}
                      id="profile-edit-date"
                      type="date"
                      className="rq-field"
                      value={form.date}
                      min={MIN_RUN_DATE}
                      max={today}
                      disabled={pending}
                      aria-invalid={errors.date ? true : undefined}
                      aria-describedby={errors.date ? 'profile-edit-date-note' : undefined}
                      onChange={(event) => edit({ date: event.target.value })}
                    />
                    {errors.date && <p id="profile-edit-date-note" className="rq-profile-field-note" data-tone="error">{errors.date}</p>}
                  </div>
                  <div className="rq-profile-field">
                    <label htmlFor="profile-edit-distance" className="rq-profile-label">Distance (km)</label>
                    <input
                      ref={distanceRef}
                      id="profile-edit-distance"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      className="rq-field rq-field--mono"
                      value={form.distance}
                      disabled={pending}
                      aria-invalid={errors.distance ? true : undefined}
                      aria-describedby={errors.distance ? 'profile-edit-distance-note' : undefined}
                      onChange={(event) => edit({ distance: event.target.value })}
                    />
                    {errors.distance && <p id="profile-edit-distance-note" className="rq-profile-field-note" data-tone="error">{errors.distance}</p>}
                  </div>
                </div>

                {xpSection}

                <p className="rq-profile-sheet__hint">Changing the date or distance recalculates your streak and XP from that day on.</p>
                <p role="alert" className="rq-profile-sheet__error">{serverError}</p>
              </div>

              <footer className="rq-profile-sheet__foot">
                <button type="submit" className="rq-btn rq-btn--primary" disabled={pending || !dirty}>
                  {update.isPending ? 'Saving…' : 'Save changes'}
                </button>
                <Dialog.Close className="rq-btn rq-btn--ghost" disabled={pending}>Cancel</Dialog.Close>
                <button
                  type="button"
                  className="rq-btn rq-btn--danger"
                  disabled={pending}
                  onClick={() => { setConfirming(true); setServerError(null); }}
                >
                  Delete run
                </button>
              </footer>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
