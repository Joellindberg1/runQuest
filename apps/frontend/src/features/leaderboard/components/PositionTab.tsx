import { Suspense, lazy, useEffect, useState } from 'react';
import { ErrorState } from '@/shared/components/ErrorState';
import { TrackLoader } from '@/shared/components/loaders/TrackLoader';
import { usePositionHistory } from '../hooks/usePositionHistory';
import { DEFAULT_POSITION_RANGE, positionWeeksFor, type PositionRange } from '../positionRange';
import { loadPositionView } from '../positionViewLoader';
import { PositionRangeSwitch } from './PositionRangeSwitch';

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
 * Innehållet i Board-fliken Position. Monteras bara när fliken är vald, så ingen positionsbegäran går på de andra flikarna. Svaret begärs här och inte i den lazy-laddade vyn, så att det
 * hämtas samtidigt med vyns chunk i stället för efter den; chunken begärs också här (den kan redan vara förladdad av flikens pekare eller fokus).
 *
 * Växeln över grafen väljer vy: de senaste åtta veckorna (standard) eller All time. Valet är tillstånd i den här komponenten, så det nollställs när fliken öppnas igen. Vid byte står den gamla
 * grafen kvar med upptagen-markering tills det nya svaret kommer; växeln står kvar också i laddning och fel, så vyn går att byta tillbaka. En grupp utan avslutad vecka har bara en vy och får
 * ingen växel.
 */
export function PositionTab({ meId }: PositionTabProps) {
  const [range, setRange] = useState<PositionRange>(DEFAULT_POSITION_RANGE);
  const history = usePositionHistory(positionWeeksFor(range));

  useEffect(() => {
    void loadPositionView();
  }, []);

  const hasFinishedWeek = !history.data || history.data.weeks.length > 1;
  const rangeSwitch = hasFinishedWeek && <PositionRangeSwitch value={range} onChange={setRange} />;

  // Felkort bara när det inte finns något att visa: en misslyckad bakgrundsomhämtning låter den gamla grafen stå kvar.
  if (history.isError && !history.data) {
    return (
      <>
        {rangeSwitch}
        <ErrorState title="Couldn't load the positions" retrying={history.isFetching} onRetry={() => void history.refetch()} />
      </>
    );
  }
  if (!history.data) {
    return (
      <>
        {rangeSwitch}
        <PositionLoading />
      </>
    );
  }
  return (
    <>
      {rangeSwitch}
      <Suspense fallback={<PositionLoading />}>
        <PositionView data={history.data} meId={meId} busy={history.isPlaceholderData} />
      </Suspense>
    </>
  );
}
