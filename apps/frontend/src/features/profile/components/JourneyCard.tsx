import { useEffect, useRef, useState } from 'react';
import { cssVars } from '@/features/leaderboard/cssVars';
import { RQIcon } from '@/shared/components/icons';
import {
  JOURNEY_END_KM, ZOOM_LABELS, getViewport, journeyPercent, lastCheckpoint, layoutWaypoints, nextCheckpointInfo, pctInView, type ZoomLevel,
} from '../frodoModel';
import { formatInt } from '../profileFormat';
import { PanelHead } from './ProfileParts';

const INITIAL_BAR_WIDTH_PX = 600;
const ZOOM_ICON_SIZE = 12;
const ZOOM_STEPS = 3;

/** Vägen med waypoints, ticks och tre zoomnivåer. Samma viewport-matematik som Runner card (frodoModel). */
function Road({ totalKm, zoom, showNext }: { totalKm: number; zoom: ZoomLevel; showNext: boolean }) {
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
  const next = nextCheckpointInfo(totalKm);
  const nextVisible = showNext && next !== null && next.km >= viewport.start && next.km <= viewport.end;
  const overview = zoom === 0;
  const startLabel = overview ? 'The Shire' : `${formatInt(viewport.start)} km`;
  const endLabel = overview ? 'Mordor' : `${formatInt(viewport.end)} km`;

  return (
    <div ref={roadRef} className="rq-profile-road">
      {waypoints.map((waypoint) => (
        <span key={`tick-${waypoint.name}`} className="rq-profile-wp__tick" data-row={waypoint.row} data-tier={waypoint.tier} style={cssVars({ '--x': `${waypoint.pct}%` })} aria-hidden="true" />
      ))}
      {waypoints.filter((waypoint) => waypoint.showLabel).map((waypoint) => (
        <span key={waypoint.name} className="rq-profile-wp__label" data-row={waypoint.row} data-tier={waypoint.tier} style={cssVars({ '--x': `${waypoint.pct}%` })}>
          {waypoint.name}
        </span>
      ))}
      <div
        className="rq-track rq-profile-track"
        role="progressbar"
        aria-label="Progress to Mount Doom"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(journeyPercent(totalKm))}
        style={cssVars({ '--w': `${fill}%` })}
      >
        <div className="rq-fill" />
        {knobVisible && <span className="rq-profile-knob" aria-hidden="true" />}
        {nextVisible && next && <span className="rq-profile-next" style={cssVars({ '--x': `${pctInView(next.km, viewport.start, viewport.end)}%` })} aria-hidden="true" />}
      </div>
      <span className="rq-profile-road__end" data-end="start" data-overview={overview}>{startLabel}</span>
      <span className="rq-profile-road__end" data-end="finish" data-overview={overview}>{endLabel}</span>
    </div>
  );
}

interface JourneyCardProps {
  totalKm: number;
  isDesktop: boolean;
}

/**
 * Frodo's journey: löparens totala km som vandring mot Mount Doom (3 266 km) med zoomknapp (Overview → Zoomed → Close-up)
 * på båda skärmstorlekarna. Mobil visar procent och nästa mål (App Prototype); desktop dessutom senaste checkpoint,
 * "away" och en ring där nästa checkpoint ligger (Web Prototype). Framme: målmeddelande och ingen zoomknapp.
 */
export function JourneyCard({ totalKm, isDesktop }: JourneyCardProps) {
  const [zoom, setZoom] = useState<ZoomLevel>(0);
  const done = totalKm >= JOURNEY_END_KM;
  const canZoom = !done && totalKm > 0;
  const percentText = `${journeyPercent(totalKm).toFixed(1)}%`;
  const checkpoint = lastCheckpoint(totalKm);
  const next = nextCheckpointInfo(totalKm);
  const progress = `${percentText} · ${formatInt(Math.min(totalKm, JOURNEY_END_KM))} / ${formatInt(JOURNEY_END_KM)} km`;

  const zoomButton = canZoom ? (
    <button type="button" className="rq-btn rq-btn--ghost rq-btn--compact" onClick={() => setZoom((current) => ((current + 1) % ZOOM_STEPS) as ZoomLevel)}>
      <RQIcon name="target" size={ZOOM_ICON_SIZE} />
      {ZOOM_LABELS[zoom]}
    </button>
  ) : undefined;

  return (
    <section className="rq-card rq-profile-journey" aria-label="Frodo's journey" data-tour="profile-journey">
      <PanelHead icon={isDesktop ? 'sparkles' : undefined} title="FRODO'S JOURNEY" note={isDesktop ? 'as Frodo' : undefined} aside={zoomButton} />

      <Road totalKm={totalKm} zoom={canZoom ? zoom : 0} showNext={isDesktop && !done} />

      {done ? (
        <p className="rq-profile-journey__sum" data-done="true">Mount Doom reached — the Ring is destroyed.</p>
      ) : (
        <>
          <p className="rq-profile-journey__sum">
            {isDesktop ? (
              <>
                <span><span className="rq-profile-journey__pin" aria-hidden="true" />Last checkpoint <span className="rq-profile-journey__em">{checkpoint.name}</span></span>
                <span>{progress}</span>
              </>
            ) : (
              <span>{progress}</span>
            )}
          </p>
          {next && (
            <p className="rq-profile-journey__sum" data-next="true">
              <span>
                {isDesktop && <span className="rq-profile-journey__pin" data-pin="next" aria-hidden="true" />}
                Next <span className="rq-profile-journey__em">{next.name} — {formatInt(next.remaining)} km{isDesktop ? ' away' : ''}</span>
              </span>
            </p>
          )}
        </>
      )}
    </section>
  );
}
