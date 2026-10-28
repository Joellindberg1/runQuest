import { useMemo } from 'react';
import { ErrorState } from '@/shared/components/ErrorState';
import { RQIcon } from '@/shared/components/icons';
import { firstName } from '@/shared/utils/format';
import type { HeadToHeadSource } from '../hooks/useRunnerPanelData';
import { headToHeadSentence } from '../headToHeadSentence';
import { buildHeadToHead } from '../runnerModel';
import { CellGrid, PanelLoading } from './RunnerParts';

/**
 * Head to head i en egen panel uppe till höger i popupens banner (ADR 006 punkt 4): rubriken "Head to head with you", en svärdikon och tre rutor (you won · drawn · you lost).
 * Panelen läses som EN mening (`headToHeadSentence`): rubriken, ikonen och siffrorna är `aria-hidden`, så skärmläsaren ger rekordet en gång. Panelen är ingen egen region, bara en del av bannern.
 *
 * Laddning, fel och inga dueller ritas inne i panelen och i samma höjd som rekordet (`--rq-runner-h2h-body-h`), så bannern inte ändrar höjd när svaret landar. Felkortet har Retry (samma
 * `ErrorState` som sidans kort, men med en kort rad om att datan är säker, så att det ryms). Panelen finns bara för en inloggad (`useRunnerPanelData`), och aldrig på egen profil: den adressen går till /profile.
 */
export function HeadToHeadBanner({ opponentName, meId, data, isError, isFetching, onRetry }: HeadToHeadSource) {
  const view = useMemo(() => (data ? buildHeadToHead(data, meId) : null), [data, meId]);

  let body;
  if (isError) {
    body = <ErrorState title="Couldn't load head to head" message="Your data is safe." retrying={isFetching} onRetry={onRetry} />;
  } else if (!data || !view) {
    body = <PanelLoading label="Loading head to head" />;
  } else if (data.record.total === 0) {
    body = <p className="rq-runner-note" aria-hidden="true">No duels against {firstName(opponentName)} yet</p>;
  } else {
    body = <CellGrid cells={view.cells} variant="record" decorative />;
  }

  return (
    <div className="rq-runner-h2h-banner">
      <div className="rq-runner-h2h-banner__head" aria-hidden="true">
        <RQIcon name="swords" size={15} />
        <span>Head to head with you</span>
      </div>
      {data && !isError && <p className="sr-only">{headToHeadSentence(data.record, opponentName)}</p>}
      <div className="rq-runner-h2h-banner__body">{body}</div>
    </div>
  );
}
