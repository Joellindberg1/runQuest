import { useMemo, useState } from 'react';
import type { PositionHistoryResponse } from '@runquest/shared';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { useElementWidth } from '../hooks/useElementWidth';
import { buildPositionChart, selectRunner } from '../positionChartModel';
import { weekLabelBudget } from '../positionWeekTicks';
import '../positionBoard.css';
import { CurrentOrder } from './CurrentOrder';
import { PositionChartCard } from './PositionChartCard';

// Position-fliken som en enhet: grafen (eller tabellen) och "Current order" med ETT delat valtillstånd. Valet bor här, i närmaste gemensamma förälder:
// ett klick i legenden väljer löparen, och grafen lyfter linjen. Att samma id igen avmarkerar bestäms av modellens `selectRunner`, så regeln finns på ett
// ställe. Radavståndet följer skalets brytpunkt (`useIsDesktop`, 1024 px); var legenden står (bredvid eller under) avgör stilen med samma brytpunkt.
//
// Fliken (`PositionTab`) hämtar svaret (`usePositionHistory`) och lazy-laddar den här komponenten (`positionViewLoader`).
// `hidden` ritar ingenting. Innan matchMedia är läst ritas ingenting (ADR 006 risk 6: gissa aldrig mobil/desktop).

interface PositionViewProps {
  data: PositionHistoryResponse;
  /** Den inloggades id; null = ingen linje är din. */
  meId: string | null;
  /** Svaret är det förra antalet veckor och det nya hämtas: vyn står kvar, bleknad och markerad upptagen, i stället för en tom ruta. */
  busy?: boolean;
}

export function PositionView({ data, meId, busy = false }: PositionViewProps) {
  const isDesktop = useIsDesktop();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Veckoetiketternas yta mäts (callback-ref som tillstånd) och bestämmer hur många etiketter en period över åtta veckor får, så de inte hamnar över varandra på en smal graf. Ytans bredd
  // hänger inte på etiketterna (rutnätskolumnen är 1fr), så ingen slinga uppstår. Före första mätningen gäller åtta.
  const [weeksField, setWeeksField] = useState<HTMLDivElement | null>(null);
  const maxWeekLabels = weekLabelBudget(useElementWidth(weeksField));
  const model = useMemo(
    () => buildPositionChart(data, { meId, mobile: isDesktop !== true, selectedId, maxWeekLabels }),
    [data, meId, isDesktop, selectedId, maxWeekLabels],
  );
  if (isDesktop === undefined || model.mode === 'hidden') return null;

  return (
    <div className="rq-card rq-board-position" aria-busy={busy}>
      <PositionChartCard model={model} weeksFieldRef={setWeeksField} />
      {/* Utan en ritad graf (ingen avslutad vecka än) finns ingen linje att lyfta: ordningen står kvar, men som en vanlig lista. */}
      <CurrentOrder entries={model.order} onSelect={model.mode === 'chart' ? (id) => setSelectedId(selectRunner(model, id).selectedId) : undefined} />
    </div>
  );
}
