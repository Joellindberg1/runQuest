import { Suspense, lazy, useMemo, useState } from 'react';
import { ErrorState } from '@/shared/components/ErrorState';
import { PositionRangeSwitch } from '@/features/leaderboard/components/PositionRangeSwitch';
import { usePositionHistory } from '@/features/leaderboard/hooks/usePositionHistory';
import { DEFAULT_POSITION_RANGE, positionWeeksFor, type PositionRange } from '@/features/leaderboard/positionRange';
import { buildPositionProfileModel } from '../positionModel';
import { PanelLoading } from './ProfileParts';

// Grafen är en lazy-chunk (ADR 007 addendum 2026-10-26): den hör inte hemma i profilens eller landningens huvudbunt. Dess import startas redan av panelens laddare
// (positionPanelLoader), så grafens chunk hämtas samtidigt med panelen och positionssvaret.
const PositionChart = lazy(() => import('./PositionChart').then(({ PositionChart: chart }) => ({ default: chart })));

interface PositionPanelProps {
  /** Löparen vars rad i svaret grafen ritar: profilens egen. */
  userId: string;
}

/**
 * Innehållet i profilens Position-flik: hämtar placeringshistoriken (samma hook och cache som leaderboarden), bygger vymodellen och ritar grafen. Panelen monteras bara när fliken är vald,
 * så ingen begäran går på övriga flikar.
 *
 * Växeln över grafen väljer vy: de senaste åtta veckorna (standard, det som förhämtas i StatsPanel) eller All time. Valet är tillstånd i panelen, så det nollställs när fliken öppnas igen.
 * Best, Lowest och Now räknas ur den valda vyns svar. Vid byte står den gamla grafen kvar med upptagen-markering tills det nya svaret kommer; växeln står kvar i laddning och fel. Utan en graf att
 * byta vy på (ingen avslutad vecka, ny löpare, dold) finns ingen växel: båda vyerna vore likadana.
 */
export function PositionPanel({ userId }: PositionPanelProps) {
  const [range, setRange] = useState<PositionRange>(DEFAULT_POSITION_RANGE);
  const history = usePositionHistory(positionWeeksFor(range));
  const model = useMemo(() => (history.data ? buildPositionProfileModel(history.data, userId) : null), [history.data, userId]);

  const rangeSwitch = (!model || model.mode === 'ready') && <PositionRangeSwitch value={range} onChange={setRange} />;

  // Felkort bara när det inte finns något att visa: en misslyckad bakgrundsomhämtning låter den gamla grafen stå kvar.
  if (history.isError && !history.data) {
    return (
      <div className="rq-profile-range-panel">
        {rangeSwitch}
        <ErrorState title="Couldn't load your position" retrying={history.isFetching} onRetry={() => void history.refetch()} />
      </div>
    );
  }
  if (!model) {
    return (
      <div className="rq-profile-range-panel">
        {rangeSwitch}
        <PanelLoading label="Loading position" />
      </div>
    );
  }
  // `hidden` ritar ingenting (fliken döljs av värden): inte ens en tom omslagsruta.
  if (model.mode === 'hidden') return null;
  return (
    <div className="rq-profile-range-panel">
      {rangeSwitch}
      <Suspense fallback={<PanelLoading label="Loading position" />}>
        <PositionChart model={model} busy={history.isPlaceholderData} />
      </Suspense>
    </div>
  );
}
