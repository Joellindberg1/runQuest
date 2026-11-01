import { Suspense, lazy, useMemo } from 'react';
import { POSITION_WEEKS_DEFAULT } from '@runquest/shared';
import { ErrorState } from '@/shared/components/ErrorState';
import { usePositionHistory } from '@/features/leaderboard/hooks/usePositionHistory';
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
 * Innehållet i profilens Position-flik: hämtar placeringshistoriken (samma hook och cache som leaderboarden, standardantalet veckor), bygger vymodellen och ritar grafen.
 * Panelen monteras bara när fliken är vald, så ingen begäran går på övriga flikar.
 */
export function PositionPanel({ userId }: PositionPanelProps) {
  const history = usePositionHistory(POSITION_WEEKS_DEFAULT);
  const model = useMemo(() => (history.data ? buildPositionProfileModel(history.data, userId) : null), [history.data, userId]);

  // Felkort bara när det inte finns något att visa: en misslyckad bakgrundsomhämtning låter den gamla grafen stå kvar.
  if (history.isError && !history.data) {
    return <ErrorState title="Couldn't load your position" retrying={history.isFetching} onRetry={() => void history.refetch()} />;
  }
  if (!model) return <PanelLoading label="Loading position" />;
  return (
    <Suspense fallback={<PanelLoading label="Loading position" />}>
      <PositionChart model={model} />
    </Suspense>
  );
}
