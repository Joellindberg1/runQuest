import { useEffect, useRef, useState } from 'react';
import { cssVars } from '@/features/leaderboard/cssVars';
import { RQIcon } from '@/shared/components/icons';
import {
  JOURNEY_END_KM, ZOOM_LABELS, getViewport, journeyPercent, layoutWaypoints, nextCheckpointInfo, pctInView, type ZoomLevel,
} from '../frodoModel';
import { formatInt } from '../profileFormat';

// Frodos väg: EN komponent för Profile och Runner card (frodoModel har matematiken, den här har markupen).
// Klassnamnen är `rq-<prefix>-…` så att varje skärms CSS äger sina egna mått (--rq-profile-* / --rq-runner-*).

const INITIAL_BAR_WIDTH_PX = 600;
const ZOOM_ICON_SIZE = 12;
/** Zoomknappen: visar nuvarande läge (Overview → Zoomed → Close-up) och stegar vidare vid tryck. */
export function ZoomButton({ zoom, onCycle }: { zoom: ZoomLevel; onCycle: () => void }) {
  return (
    <button type="button" className="rq-btn rq-btn--ghost rq-btn--compact" onClick={onCycle}>
      <RQIcon name="target" size={ZOOM_ICON_SIZE} />
      {ZOOM_LABELS[zoom]}
    </button>
  );
}

interface FrodoRoadProps {
  /** `profile` eller `runner`: prefix för klassnamnen. */
  prefix: 'profile' | 'runner';
  totalKm: number;
  zoom: ZoomLevel;
  /** Ring där nästa checkpoint ligger (Profile på desktop). */
  showNext?: boolean;
}

/** Vägen med waypoints, ticks, framstegsstapel, markör och start-/slutetiketter för vald zoomnivå. */
export function FrodoRoad({ prefix, totalKm, zoom, showNext = false }: FrodoRoadProps) {
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
  const next = showNext ? nextCheckpointInfo(totalKm) : null;
  const nextVisible = next !== null && next.km >= viewport.start && next.km <= viewport.end;
  const overview = zoom === 0;
  const startLabel = overview ? 'The Shire' : `${formatInt(viewport.start)} km`;
  const endLabel = overview ? 'Mordor' : `${formatInt(viewport.end)} km`;

  return (
    <div ref={roadRef} className={`rq-${prefix}-road`}>
      {waypoints.map((waypoint) => (
        <span key={`tick-${waypoint.name}`} className={`rq-${prefix}-wp__tick`} data-row={waypoint.row} data-tier={waypoint.tier} style={cssVars({ '--x': `${waypoint.pct}%` })} aria-hidden="true" />
      ))}
      {waypoints.filter((waypoint) => waypoint.showLabel).map((waypoint) => (
        <span key={waypoint.name} className={`rq-${prefix}-wp__label`} data-row={waypoint.row} data-tier={waypoint.tier} style={cssVars({ '--x': `${waypoint.pct}%` })}>
          {waypoint.name}
        </span>
      ))}
      <div
        className={`rq-track rq-${prefix}-track`}
        role="progressbar"
        aria-label="Progress to Mount Doom"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(journeyPercent(totalKm))}
        style={cssVars({ '--w': `${fill}%` })}
      >
        <div className="rq-fill" />
        {knobVisible && <span className={`rq-${prefix}-knob`} aria-hidden="true" />}
        {nextVisible && next && <span className={`rq-${prefix}-next`} style={cssVars({ '--x': `${pctInView(next.km, viewport.start, viewport.end)}%` })} aria-hidden="true" />}
      </div>
      <span className={`rq-${prefix}-road__end`} data-end="start" data-overview={overview}>{startLabel}</span>
      <span className={`rq-${prefix}-road__end`} data-end="finish" data-overview={overview}>{endLabel}</span>
    </div>
  );
}
