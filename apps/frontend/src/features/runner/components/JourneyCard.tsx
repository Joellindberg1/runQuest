import { useEffect, useRef, useState } from 'react';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { cssVars } from '@/features/leaderboard/cssVars';
import { formatInt } from '@/features/leaderboard/boardFormat';
import {
  JOURNEY_END_KM, ZOOM_LABELS, getViewport, journeyPercent, lastCheckpoint, layoutWaypoints, pctInView, type ZoomLevel,
} from '@/features/profile/frodoModel';
import { RQIcon } from '@/shared/components/icons';
import { PanelHead } from './RunnerParts';

const INITIAL_BAR_WIDTH_PX = 600;
const ZOOM_STEPS = 3;

/** Mobil: en enkel stapel (App Prototype). Fylls från noll en gång, sedan stilla. */
function SimpleRoad({ percent }: { percent: number }) {
  return (
    <>
      <div
        className="rq-track rq-runner-track"
        role="progressbar"
        aria-label="Progress to Mount Doom"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        style={cssVars({ '--w': `${percent}%` })}
      >
        <div className="rq-fill" />
        <span className="rq-runner-knob" aria-hidden="true" />
      </div>
      <div className="rq-runner-ends">
        <span data-end="start">Shire</span>
        <span>Moria</span>
        <span data-end="finish">Mordor</span>
      </div>
    </>
  );
}

/** Desktop (overlayn): vägen med waypoints och tre zoomnivåer — samma viewport-matematik som profilen. */
function ZoomRoad({ totalKm, zoom }: { totalKm: number; zoom: ZoomLevel }) {
  const roadRef = useRef<HTMLDivElement>(null);
  const [barWidth, setBarWidth] = useState(INITIAL_BAR_WIDTH_PX);

  useEffect(() => {
    const el = roadRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) => setBarWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const posKm = Math.min(totalKm, JOURNEY_END_KM);
  const viewport = getViewport(zoom, posKm);
  const waypoints = layoutWaypoints(zoom, viewport, barWidth);
  const fill = Math.max(0, Math.min(100, pctInView(posKm, viewport.start, viewport.end)));
  const knobVisible = posKm >= viewport.start && posKm <= viewport.end;
  const overview = zoom === 0;
  const startLabel = overview ? 'The Shire' : `${formatInt(viewport.start)} km`;
  const endLabel = overview ? 'Mordor' : `${formatInt(viewport.end)} km`;

  return (
    <div ref={roadRef} className="rq-runner-road">
      {waypoints.map((waypoint) => (
        <span key={`tick-${waypoint.name}`} className="rq-runner-wp__tick" data-row={waypoint.row} data-tier={waypoint.tier} style={cssVars({ '--x': `${waypoint.pct}%` })} aria-hidden="true" />
      ))}
      {waypoints.filter((waypoint) => waypoint.showLabel).map((waypoint) => (
        <span key={waypoint.name} className="rq-runner-wp__label" data-row={waypoint.row} data-tier={waypoint.tier} style={cssVars({ '--x': `${waypoint.pct}%` })}>
          {waypoint.name}
        </span>
      ))}
      <div
        className="rq-track rq-runner-track rq-runner-track--road"
        role="progressbar"
        aria-label="Progress to Mount Doom"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(journeyPercent(totalKm))}
        style={cssVars({ '--w': `${fill}%` })}
      >
        <div className="rq-fill" />
        {knobVisible && <span className="rq-runner-knob" aria-hidden="true" />}
      </div>
      <span className="rq-runner-road__end" data-end="start" data-overview={overview}>{startLabel}</span>
      <span className="rq-runner-road__end" data-end="finish" data-overview={overview}>{endLabel}</span>
    </div>
  );
}

/** Frodo's journey: löparens totala km som vandring mot Mount Doom (3 266 km), med senaste checkpoint. */
export function JourneyCard({ totalKm }: { totalKm: number }) {
  const isDesktop = useIsDesktop() === true;
  const [zoom, setZoom] = useState<ZoomLevel>(0);
  const percent = journeyPercent(totalKm);
  const checkpoint = lastCheckpoint(totalKm);
  const done = totalKm >= JOURNEY_END_KM;
  const canZoom = isDesktop && !done && totalKm > 0;
  const percentText = `${percent.toFixed(1)}%`;
  // Desktop: zoomknappen. Mobil: bara procenten (App Prototype). Desktop utan något att zooma (0 km / framme): ingenting.
  const zoomButton = (
    <button type="button" className="rq-btn rq-btn--ghost rq-btn--compact" onClick={() => setZoom((current) => ((current + 1) % ZOOM_STEPS) as ZoomLevel)}>
      <RQIcon name="target" size={12} />
      {ZOOM_LABELS[zoom]}
    </button>
  );
  const aside = isDesktop ? (canZoom ? zoomButton : undefined) : percentText;

  return (
    <section className="rq-card rq-runner-journey" aria-label="Frodo's journey">
      <PanelHead
        icon={isDesktop ? 'sparkles' : undefined}
        title="FRODO'S JOURNEY"
        aside={aside}
      />

      {isDesktop ? <ZoomRoad totalKm={totalKm} zoom={canZoom ? zoom : 0} /> : <SimpleRoad percent={percent} />}

      {done ? (
        <p className="rq-runner-journey__sum" data-done="true">Mount Doom reached — the Ring is destroyed.</p>
      ) : (
        <p className="rq-runner-journey__sum">
          <span>Last checkpoint <span className="rq-runner-journey__cp">{checkpoint.name}</span></span>
          {isDesktop && <span>{percentText} · {formatInt(totalKm)} / {formatInt(JOURNEY_END_KM)} km</span>}
        </p>
      )}
    </section>
  );
}
