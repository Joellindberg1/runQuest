import { useRef } from 'react';
import { MAX_SHOWCASE } from '@runquest/shared';
import type { BadgeRow } from '../badgeModel';
import type { ShowcaseDraft } from '../hooks/useShowcaseDraft';
import { BadgeMinis } from './BadgeMinis';
import '../badges.css';

interface BadgeDisplayStripProps {
  /** Samlingens rader: bär tiern för minisen i remsan. */
  rows: readonly BadgeRow[];
  /** Utkastet och sparandet (`useShowcaseDraft`). Sidan äger hooken, så korten och remsan läser samma utkast. */
  display: ShowcaseDraft;
  /** id på den synliga meningen "3 of 3 on display — remove one first." (växlarnas `aria-describedby` pekar hit). */
  limitId: string;
  /** `undefined` tills brytpunkten är läst: ingen text som beror på den ritas då. */
  isDesktop: boolean | undefined;
}

function saveLabel(display: ShowcaseDraft): string {
  if (display.saving) return 'SAVING…';
  return display.dirty ? 'SAVE DISPLAY' : 'SAVED';
}

/**
 * ON DISPLAY-remsan överst på /badges (spec F9.3) med SAVE DISPLAY — sidans enda guldknapp — och statusraderna under den.
 *
 * Remsan visar UTKASTET i vald ordning (inte serverns sparade val) som minis; tomt utkast ritar inga minis och ingen platshållare.
 * SAVE DISPLAY är `aria-disabled` (aldrig `disabled`, så fokus inte faller till body) när inget är osparat och medan sparandet pågår; klicket spärras i hanteraren.
 *
 * Statusraderna är permanenta behållare som finns innan texten monteras, så skärmläsaren annonserar ändringarna: `aria-live` (3-av-3-meningen + senaste ändringen),
 * `role="status"` (sparat, grön kant) och `role="alert"` (fel, röd kant + RETRY). RETRY flyttar fokus till SAVE DISPLAY innan felraden försvinner.
 */
export function BadgeDisplayStrip({ rows, display, limitId, isDesktop }: BadgeDisplayStripProps) {
  const saveRef = useRef<HTMLButtonElement>(null);
  const tiers = new Map(rows.map((row) => [row.series, row.tier]));
  const showcase = display.draft.map((series) => ({ series, tier: tiers.get(series) as number }));
  const saveDisabled = !display.dirty || display.saving;

  const save = () => {
    if (saveDisabled) return;
    void display.save();
  };

  // Felraden försvinner när sparandet startar: fokus går då till SAVE DISPLAY i stället för att falla till body.
  const retry = () => {
    saveRef.current?.focus();
    void display.save();
  };

  return (
    <div className="rq-badge-strip">
      <div className="rq-badge-strip__bar" role="group" aria-label="On display">
        <span className="rq-badge-strip__label">On display</span>
        <BadgeMinis showcase={showcase} />
        {isDesktop === true && <p className="rq-badge-strip__hint">Shown on your Board card and next to your name — pick up to {MAX_SHOWCASE} below.</p>}
        {isDesktop === false && display.draft.length === 0 && <p className="rq-badge-strip__hint">Pick up to {MAX_SHOWCASE} badges to show on the Board.</p>}
        <button
          type="button"
          ref={saveRef}
          className="rq-btn rq-btn--secondary rq-btn--compact rq-badge-strip__save"
          aria-disabled={saveDisabled ? true : undefined}
          onClick={save}
        >
          {saveLabel(display)}
        </button>
      </div>

      <div aria-live="polite">
        {display.full && <p id={limitId} className="rq-badge-strip__limit">{MAX_SHOWCASE} of {MAX_SHOWCASE} on display — remove one first.</p>}
        <span className="sr-only">{display.announcement}</span>
      </div>
      <div role="status">
        {display.status === 'saved' && <p className="rq-badge-note" data-status="saved">Saved — your Board card is updated.</p>}
      </div>
      <div role="alert">
        {display.status === 'error' && (
          <div className="rq-badge-note" data-status="error">
            <span>Could not save. Your pick is still here — try again.</span>
            <button type="button" className="rq-badge-retry" onClick={retry}>RETRY</button>
          </div>
        )}
      </div>
    </div>
  );
}
