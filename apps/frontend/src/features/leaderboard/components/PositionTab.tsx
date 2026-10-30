import { Suspense, lazy, useEffect } from 'react';
import { POSITION_WEEKS_DEFAULT } from '@runquest/shared';
import { ErrorState } from '@/shared/components/ErrorState';
import { TrackLoader } from '@/shared/components/loaders/TrackLoader';
import { usePositionHistory } from '../hooks/usePositionHistory';
import { loadPositionView } from '../positionViewLoader';

// Position-vyn (grafen, "Current order", tabellen och deras stil) är en egen chunk och väger inte i Boards ingångsbunt. Den här flikdelen är liten och statisk: den hämtar
// svaret, visar laddning och fel, och lazy-laddar vyn.
const PositionView = lazy(loadPositionView);

const LOADER_SIZE = 64;

/** Stadion-ovalen (regel 9) medan svaret eller vyns chunk hämtas, och medan sidan väntar på gruppen. */
export function PositionLoading() {
  return (
    <div className="rq-board__loading">
      <TrackLoader size={LOADER_SIZE} label="Loading position" />
    </div>
  );
}

interface PositionTabProps {
  /** Den inloggades id; null = ingen linje är din. */
  meId: string | null;
}

/**
 * Innehållet i Board-fliken Position. Monteras bara när fliken är vald, så ingen positionsbegäran går på de andra flikarna. Svaret (standardantalet veckor) begärs här och inte i den
 * lazy-laddade vyn, så att det hämtas samtidigt med vyns chunk i stället för efter den; chunken begärs också här (den kan redan vara förladdad av flikens pekare eller fokus).
 */
export function PositionTab({ meId }: PositionTabProps) {
  const history = usePositionHistory(POSITION_WEEKS_DEFAULT);

  useEffect(() => {
    void loadPositionView();
  }, []);

  // Felkort bara när det inte finns något att visa: en misslyckad bakgrundsomhämtning låter den gamla grafen stå kvar.
  if (history.isError && !history.data) {
    return <ErrorState title="Couldn't load the positions" retrying={history.isFetching} onRetry={() => void history.refetch()} />;
  }
  if (!history.data) return <PositionLoading />;
  return (
    <Suspense fallback={<PositionLoading />}>
      <PositionView data={history.data} meId={meId} />
    </Suspense>
  );
}
