import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { MAX_SHOWCASE } from '@runquest/shared';
import { cleanShowcase, sameShowcase, toggleShowcase, type BadgeRow } from '../badgeModel';
import { useSaveShowcase } from '../hooks/useBadgeQueries';
import { BadgeChip } from './BadgeChip';
import { BadgeEmblem } from './BadgeEmblem';
import { ShowcaseSlots } from './ShowcaseSlots';
import { SHOWCASE_PICKER_ID } from './showcasePickerId';
import '../badges.css';

const TITLE_ID = 'badge-showcase-picker-title';
const LIMIT_ID = 'badge-showcase-picker-limit';

type SaveStatus = 'idle' | 'saved' | 'error';

interface ShowcasePickerProps {
  /** Samlingens rader (`buildCollection`), en per serie i serieordning. Raderna bär det sparade valet (`displayPosition`) och vad jag äger. */
  rows: readonly BadgeRow[];
  userId: string | undefined;
  onClose: () => void;
}

/**
 * Väljaren för visade badges (spec F3, Design Council 16-18): ON DISPLAY-platspanelen (steg 3), SAVE DISPLAY + sparlägen (steg 2) och en rad per serie
 * med en växlare (steg 1). EN panel, samma på mobil och desktop (desktop: den 340 px breda sidokolumnen). "Preview on leaderboard" byggs inte (uppföljning).
 *
 * Utkastet ligger lokalt tills `useSaveShowcase().save` lyckas; en serie jag tappat städas ur utkastet (`cleanShowcase`). Efter spara uppdaterar hooken min samling
 * optimistiskt och invaliderar gruppen, så remsan, hjältekortet och Board-minisen följer med. Fel behåller valet (hooken återställer samlingen, inte utkastet).
 * Fokus flyttas hit när panelen öppnas; skärmen återför det till Edit-knappen vid stängning (Close eller Esc).
 */
export function ShowcasePicker({ rows, userId, onClose }: ShowcasePickerProps) {
  const panelRef = useRef<HTMLElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const owned = useMemo(() => rows.filter((row) => row.earned).map((row) => row.series), [rows]);
  const saved = useMemo(
    () => rows.filter((row) => row.displayPosition !== null).sort((a, b) => (a.displayPosition as number) - (b.displayPosition as number)).map((row) => row.series),
    [rows],
  );
  const [picked, setPicked] = useState<string[]>(saved);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [announcement, setAnnouncement] = useState('');
  const { save, isPending } = useSaveShowcase(userId);

  // Fokus utan webbläsarens hopp; sedan bara så mycket scroll att panelen kommer i bild (scroll-margin-top håller den fri från skalets topprad).
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
    panelRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);

  // Utkastet städat mot det jag äger just nu: en serie som försvunnit under tiden (nedgradering) ligger aldrig kvar som vald.
  const draft = useMemo(() => cleanShowcase(picked, owned), [picked, owned]);
  const byKey = useMemo(() => new Map(rows.map((row) => [row.series, row])), [rows]);
  const selectedRows = draft.map((key) => byKey.get(key) as BadgeRow);
  const dirty = !sameShowcase(draft, saved);
  const full = draft.length >= MAX_SHOWCASE;

  const change = (next: string[], message: string) => {
    setPicked(next);
    setStatus('idle');
    setAnnouncement(message);
  };

  const toggle = (row: BadgeRow) => {
    if (isPending) return;
    const on = draft.includes(row.series);
    if (!on && full) return;
    const next = toggleShowcase(draft, owned, row.series);
    change(next, on ? `${row.name} removed from display.` : `${row.name} added to display, position ${next.indexOf(row.series) + 1}.`);
  };

  const remove = (series: string) => {
    if (isPending) return;
    change(draft.filter((key) => key !== series), `${byKey.get(series)?.name ?? series} removed from display.`);
  };

  const onSave = async () => {
    if (!dirty || isPending) return;
    setStatus('idle');
    try {
      await save(draft);
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };

  // RETRY försvinner med felraden när sparandet startar: fokus går då till SAVE DISPLAY i stället för att falla till body.
  const retry = () => {
    saveRef.current?.focus();
    void onSave();
  };

  const onKeyDown =(event: KeyboardEvent) => {
    if (event.key === 'Escape') onClose();
  };

  return (
    <section id={SHOWCASE_PICKER_ID} ref={panelRef} tabIndex={-1} className="rq-card rq-badge-pick" aria-labelledby={TITLE_ID} onKeyDown={onKeyDown}>
      <header className="rq-badge-pick__head">
        <h2 id={TITLE_ID} className="rq-title rq-badge-pick__title">ON DISPLAY</h2>
        <span className="rq-badge-pick__count">{draft.length} / {MAX_SHOWCASE}</span>
        <button type="button" className="rq-badge-textlink" onClick={onClose}>Close</button>
      </header>

      <ShowcaseSlots selected={selectedRows} busy={isPending} onRemove={remove} />

      {/* Statusändringar läses upp artigt: det synliga gränsmeddelandet och en osynlig rad om det senaste valet. */}
      <div aria-live="polite">
        {full && <p id={LIMIT_ID} className="rq-badge-pick__limit">{MAX_SHOWCASE} of {MAX_SHOWCASE} on display — remove one first.</p>}
        <span className="sr-only">{announcement}</span>
      </div>

      {/* aria-disabled i stället för disabled: en avstängd knapp släpper fokus (till body) mitt under spara/retry. Klicket spärras i onSave. */}
      <button
        type="button"
        ref={saveRef}
        className="rq-btn rq-btn--secondary rq-btn--compact rq-badge-pick__save"
        aria-disabled={!dirty || isPending ? true : undefined}
        onClick={() => void onSave()}
      >
        {isPending ? 'SAVING…' : 'SAVE DISPLAY'}
      </button>
      <div role="status">
        {status === 'saved' && <p className="rq-badge-pick__note" data-status="saved">Saved — your Board card is updated.</p>}
      </div>
      {status === 'error' && (
        <div role="alert" className="rq-badge-pick__note" data-status="error">
          <span>Could not save. Your pick is still here — try again.</span>
          <button type="button" className="rq-badge-pick__retry" onClick={retry}>RETRY</button>
        </div>
      )}

      <ul className="rq-badge-pick__list" aria-label="Choose badges to display">
        {rows.map((row) => {
          const position = draft.indexOf(row.series) + 1;
          const on = position > 0;
          const blocked = !row.earned ? false : !on && full;
          return (
            <li key={row.series} className="rq-badge-pick__row" data-state={row.earned ? 'earned' : 'locked'}>
              <BadgeEmblem series={row.series} tier={row.tier} size="sm" decorative />
              <span className="rq-badge-pick__who">
                <span className="rq-badge-pick__name">{row.name}</span>
                {row.earned ? <BadgeChip tier={row.tier} /> : <span className="rq-badge-pick__locked-note">Locked — cannot be selected</span>}
              </span>
              {row.earned ? (
                <button
                  type="button"
                  className="rq-badge-pick__toggle"
                  aria-pressed={on}
                  aria-disabled={blocked ? true : undefined}
                  aria-describedby={blocked ? LIMIT_ID : undefined}
                  onClick={() => toggle(row)}
                >
                  <span className="sr-only">{row.name}: </span>
                  {on ? `On display — ${position}` : 'Show'}
                </button>
              ) : (
                <span className="rq-badge-pick__toggle rq-badge-pick__toggle--locked" aria-hidden="true">Locked</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
