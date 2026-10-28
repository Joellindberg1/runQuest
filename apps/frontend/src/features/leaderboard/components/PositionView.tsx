import { useMemo, useState } from 'react';
import type { PositionHistoryResponse } from '@runquest/shared';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { buildPositionChart, selectRunner } from '../positionChartModel';
import '../positionBoard.css';
import { CurrentOrder } from './CurrentOrder';
import { PositionChartCard } from './PositionChartCard';

// Position-fliken som en enhet: grafen (eller tabellen) och "Current order" med ETT delat valtillstånd. Valet bor här, i närmaste gemensamma förälder:
// ett klick i legenden väljer löparen, och grafen lyfter linjen. Att samma id igen avmarkerar bestäms av modellens `selectRunner`, så regeln finns på ett
// ställe. Radavståndet följer skalets brytpunkt (`useIsDesktop`, 1024 px); var legenden står (bredvid eller under) avgör stilen med samma brytpunkt.
//
// Fliken (en egen story) hämtar svaret (`usePositionHistory`) och lazy-laddar den här komponenten: `React.lazy(() => import('./PositionView'))`.
// `hidden` ritar ingenting. Innan matchMedia är läst ritas ingenting (ADR 006 risk 6: gissa aldrig mobil/desktop).

interface PositionViewProps {
  data: PositionHistoryResponse;
  /** Den inloggades id; null = ingen linje är din. */
  meId: string | null;
}

export function PositionView({ data, meId }: PositionViewProps) {
  const isDesktop = useIsDesktop();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const model = useMemo(
    () => buildPositionChart(data, { meId, mobile: isDesktop !== true, selectedId }),
    [data, meId, isDesktop, selectedId],
  );
  if (isDesktop === undefined || model.mode === 'hidden') return null;

  return (
    <div className="rq-card rq-board-position">
      <PositionChartCard model={model} />
      <CurrentOrder entries={model.order} onSelect={(id) => setSelectedId(selectRunner(model, id).selectedId)} />
    </div>
  );
}
