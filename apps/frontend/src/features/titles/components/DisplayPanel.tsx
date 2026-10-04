import { RQIcon } from '@/shared/components/icons';
import { TrackLoader } from '@/shared/components/loaders/TrackLoader';
import { MAX_DISPLAYED, formatDisplayPreview, type DisplayedRow } from '../titlesModel';
import type { SaveStatus } from '../hooks/useDisplaySelection';

const LOADER_SIZE = 40;
const REMOVE_ICON_SIZE = 15;

interface DisplayPanelProps {
  /** false medan gruppens användare (där det sparade valet bor) inte har laddats. */
  ready: boolean;
  rows: DisplayedRow[];
  totalHeld: number;
  dirty: boolean;
  saving: boolean;
  status: SaveStatus;
  onRemove: (titleId: string) => void;
  onSave: () => void;
}

/** "ON DISPLAY": de (högst tre) titlar som visas på leaderboard-kortet, med förhandsvisning och Spara. */
export function DisplayPanel({ ready, rows, totalHeld, dirty, saving, status, onRemove, onSave }: DisplayPanelProps) {
  return (
    <section className="rq-card rq-titles-side" aria-label="On display" data-tour="titles-display">
      <header className="rq-titles-side__head">
        <h2 className="rq-title rq-titles-side__title">ON DISPLAY</h2>
        <span className="rq-titles-side__aside">
          {rows.length} / {MAX_DISPLAYED}
        </span>
      </header>

      {!ready ? (
        <div className="rq-titles-side__loading">
          <TrackLoader size={LOADER_SIZE} label="Loading your selection" />
        </div>
      ) : (
        <>
          {rows.length === 0 ? (
            <p className="rq-titles-note">
              {totalHeld === 0 ? 'Hold a title to put it on display.' : 'Pick up to three of your titles to show on the leaderboard.'}
            </p>
          ) : (
            <ol className="rq-titles-slots" aria-label="Titles on display">
              {rows.map((row) => (
                <li key={row.id} className="rq-titles-slot">
                  <span className="rq-titles-slot__pos">{row.position}</span>
                  <span className="rq-titles-slot__text">
                    <span className="rq-titles-slot__name">{row.name}</span>
                    <span className="rq-titles-slot__value">{row.value}</span>
                  </span>
                  <button type="button" className="rq-titles-slot__remove" aria-label={`Remove ${row.name} from display`} onClick={() => onRemove(row.id)}>
                    <RQIcon name="plus" size={REMOVE_ICON_SIZE} />
                  </button>
                </li>
              ))}
            </ol>
          )}

          <div className="rq-titles-preview">
            <p className="rq-titles-preview__label">Preview on leaderboard</p>
            <p className="rq-titles-preview__text">{formatDisplayPreview(rows.map((row) => row.name), totalHeld)}</p>
          </div>

          {totalHeld > 0 && (
            <button type="button" className="rq-btn rq-btn--secondary rq-btn--compact rq-titles-save" disabled={!dirty || saving} onClick={onSave}>
              {saving ? 'Saving…' : 'Save display'}
            </button>
          )}
          <p className="rq-titles-status" role="status" data-status={status}>
            {status === 'saved' && 'Saved — your leaderboard card is updated.'}
            {status === 'error' && 'Could not save. Your pick is still here — try again.'}
          </p>
        </>
      )}
    </section>
  );
}
