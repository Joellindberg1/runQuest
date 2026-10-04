import React, { useEffect, useRef, useState } from 'react';
import {
  ALL_WAYPOINTS, JOURNEY_END_KM, getViewport, lastCheckpoint, nextCheckpointInfo, pctInView,
  type ZoomLevel,
} from '../frodoModel';

// Äldre presentation (egna profilen) — matematiken bor i ../frodoModel och delas med Runner card.
// Ritas om i inkrement 8.
// TODO(i8): etikettlayouten nedan (egen loop med rader/gap/MIN_LABEL_PX) dubblerar frodoModel.layoutWaypoints som
// Runner card använder — byt till den när presentationen ritas om, så finns bara en layoutalgoritm.

// ─── Pixel layout ─────────────────────────────────────────────────────────────
//   y=0          ─── far labels    (row 1, gap[1] px above bar)
//   y=topH-gap[1]-labelH
//   y=topH-gap[0]-labelH ─── close labels (row 0)
//   y=topH       ─────────────── BAR ──────────────────
//   y=topH+barH+belowMargin ── start / end labels
const J = {
  topH:        68,
  barH:        12,
  belowMargin: 6,
  gap:         [18, 48] as [number, number],
  labelH:      12,
  totalH:      102,
} as const;

// ─── Icons ────────────────────────────────────────────────────────────────────

const ZoomInIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <circle cx="6.5" cy="6.5" r="4.5" />
    <line x1="10" y1="10" x2="14" y2="14" />
    <line x1="6.5" y1="4.5" x2="6.5" y2="8.5" />
    <line x1="4.5" y1="6.5" x2="8.5" y2="6.5" />
  </svg>
);

const ZoomOutIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <circle cx="6.5" cy="6.5" r="4.5" />
    <line x1="10" y1="10" x2="14" y2="14" />
    <line x1="4.5" y1="6.5" x2="8.5" y2="6.5" />
  </svg>
);

// ─── Component ────────────────────────────────────────────────────────────────

// Minimum px gap between label centres in the same row before we suppress a label.
// Tier-1 waypoints always show regardless.
const MIN_LABEL_PX = 56;

export const FrodoJourney: React.FC<{ totalKm: number }> = ({ totalKm }) => {
  const [zoom, setZoom]       = useState<ZoomLevel>(0);
  const [barWidth, setBarWidth] = useState(600);
  const barRef = useRef<HTMLDivElement>(null);

  // Track the rendered width so we can compute pixel distances between labels
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => setBarWidth(entry.contentRect.width));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const done  = totalKm >= JOURNEY_END_KM;
  const posKm = Math.min(totalKm, JOURNEY_END_KM);

  const checkpoint = lastCheckpoint(totalKm);
  const nextCp     = nextCheckpointInfo(totalKm);

  const { start: vStart, end: vEnd } = getViewport(zoom, posKm);

  // At zoom 0 only show tier-1; at zoom 1/2 show all
  const maxTier = zoom === 0 ? 1 : 2;

  // Visible intermediate waypoints (not the two endpoints)
  const visibleWaypoints = ALL_WAYPOINTS.filter(w =>
    w.km > 0 &&
    w.km < JOURNEY_END_KM &&
    w.tier <= maxTier &&
    w.km > vStart &&
    w.km < vEnd,
  );

  // Assign alternating rows and decide per-row whether a label fits.
  // Tier-1 waypoints always show their label; tier-2 labels are suppressed
  // if the nearest already-shown label in the same row is < MIN_LABEL_PX away.
  const computed = (() => {
    const lastShownPx: [number, number] = [-Infinity, -Infinity];
    return visibleWaypoints.map((w, i) => {
      const row      = (i % 2) as 0 | 1;
      const gap      = J.gap[row];
      const labelTop = J.topH - gap - J.labelH;
      const tickTop  = J.topH - gap;
      const pxPos    = (pctInView(w.km, vStart, vEnd) / 100) * barWidth;

      const fits      = (pxPos - lastShownPx[row]) >= MIN_LABEL_PX;
      const showLabel = w.tier === 1 || fits;
      if (showLabel) lastShownPx[row] = pxPos;

      return { ...w, row, labelTop, tickTop, tickH: gap, showLabel };
    });
  })();

  // Bar fill: how far into the current viewport the user is
  const fillPct = posKm >= vEnd   ? 100
                : posKm <= vStart ? 0
                : pctInView(posKm, vStart, vEnd);

  const posInView  = posKm  >= vStart && posKm  <= vEnd;
  const nextInView = nextCp !== null  && nextCp.km >= vStart && nextCp.km <= vEnd;

  const belowLabelTop = J.topH + J.barH + J.belowMargin;

  // Endpoint labels change in zoom mode
  const startLabel = zoom === 0 ? 'The Shire' : `${Math.round(vStart).toLocaleString()} km`;
  const endLabel   = zoom === 0 ? 'MORDOR'    : `${Math.round(vEnd).toLocaleString()} km`;

  function cycleZoom() {
    setZoom(z => ((z + 1) % 3) as ZoomLevel);
  }

  const zoomLabels: Record<ZoomLevel, string> = {
    0: 'Overview',
    1: 'Zoomed',
    2: 'Close-up',
  };

  return (
    <div className="select-none w-full">

      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <div
          className="text-xs font-semibold"
          style={{ color: 'var(--rq-gold)', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.12em' }}
        >
          AS FRODO
        </div>

        {!done && totalKm > 0 && (
          <button
            onClick={cycleZoom}
            className="flex items-center gap-1.5 text-xs px-2 py-0.5 rounded border border-foreground/20 text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
          >
            {zoom < 2 ? <ZoomInIcon /> : <ZoomOutIcon />}
            {zoomLabels[zoom]}
          </button>
        )}
      </div>

      {/* Bar area */}
      <div ref={barRef} className="relative w-full overflow-hidden" style={{ height: J.totalH }}>

        {/* Labels above bar — only rendered when there is room */}
        {computed.map(w => w.showLabel && (
          <span
            key={w.name}
            className="absolute text-xs leading-none whitespace-nowrap transition-[left] duration-300 ease-in-out"
            style={{
              top:       w.labelTop,
              left:      `${pctInView(w.km, vStart, vEnd)}%`,
              transform: 'translateX(-50%)',
              color:     w.tier === 1
                ? 'color-mix(in srgb, var(--foreground) 75%, transparent)'
                : 'color-mix(in srgb, var(--foreground) 45%, transparent)',
              fontWeight: w.tier === 1 ? 600 : 400,
            }}
          >
            {w.name}
          </span>
        ))}

        {/* Ticks */}
        {computed.map(w => (
          <div
            key={`tick-${w.name}`}
            className="absolute pointer-events-none transition-[left] duration-300 ease-in-out"
            style={{
              top:        w.tickTop,
              height:     w.tickH,
              left:       `${pctInView(w.km, vStart, vEnd)}%`,
              width:      1,
              background: w.tier === 1
                ? `linear-gradient(to bottom, color-mix(in srgb, var(--rq-gold) 55%, transparent), color-mix(in srgb, var(--rq-gold) 80%, transparent))`
                : `linear-gradient(to bottom, color-mix(in srgb, var(--rq-gold) 25%, transparent), color-mix(in srgb, var(--rq-gold) 50%, transparent))`,
            }}
          />
        ))}

        {/* Progress bar */}
        <div
          className="absolute left-0 right-0 rounded-full bg-foreground/10"
          style={{ top: J.topH, height: J.barH }}
        >
          <div
            className="absolute h-full rounded-l-full transition-[width] duration-300 ease-in-out"
            style={{ width: `${fillPct}%`, background: 'var(--rq-gold)' }}
          />

          {/* Current position needle (filled gold) */}
          {!done && posInView && (
            <div
              className="absolute w-4 h-4 rounded-full border-2 border-background pointer-events-none transition-[left] duration-300 ease-in-out"
              style={{
                left:      `${pctInView(posKm, vStart, vEnd)}%`,
                top:       '50%',
                transform: 'translate(-50%, -50%)',
                background: 'var(--rq-gold)',
                boxShadow:  '0 0 8px color-mix(in srgb, var(--rq-gold) 70%, transparent)',
              }}
            />
          )}

          {/* Next checkpoint needle (hollow ring) */}
          {nextInView && (
            <div
              className="absolute w-4 h-4 rounded-full pointer-events-none transition-[left] duration-300 ease-in-out"
              style={{
                left:       `${pctInView(nextCp!.km, vStart, vEnd)}%`,
                top:        '50%',
                transform:  'translate(-50%, -50%)',
                border:     '2px solid var(--rq-gold)',
                background: 'var(--background)',
                opacity:    0.7,
              }}
            />
          )}
        </div>

        {/* Endpoint labels */}
        <span
          className="absolute text-xs leading-none font-bold whitespace-nowrap"
          style={{
            top:   belowLabelTop,
            left:  0,
            color: zoom === 0 ? 'var(--rq-success)' : 'color-mix(in srgb, var(--foreground) 40%, transparent)',
          }}
        >
          {startLabel}
        </span>
        <span
          className="absolute text-xs leading-none font-bold whitespace-nowrap"
          style={{
            top:   belowLabelTop,
            right: 0,
            color: zoom === 0 ? 'var(--rq-danger)' : 'color-mix(in srgb, var(--foreground) 40%, transparent)',
          }}
        >
          {endLabel}
        </span>

      </div>

      {/* Summary */}
      <div className="mt-2 space-y-0.5">
        {done ? (
          <p className="text-xs font-semibold" style={{ color: 'var(--rq-gold)' }}>
            🌋 You've destroyed the Ring! Mount Doom reached!
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full border-2 border-background align-middle mr-1.5"
                  style={{ background: 'var(--rq-gold)', boxShadow: '0 0 4px color-mix(in srgb, var(--rq-gold) 60%, transparent)' }}
                />
                Last checkpoint: <span className="font-medium text-foreground">{checkpoint.name}</span>
              </span>
              <span>
                {((posKm / JOURNEY_END_KM) * 100).toFixed(1)}% · {Math.round(totalKm).toLocaleString()} / {JOURNEY_END_KM.toLocaleString()} km
              </span>
            </div>
            {nextCp && (
              <div className="text-sm text-muted-foreground">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full align-middle mr-1.5"
                  style={{ border: '2px solid var(--rq-gold)', background: 'transparent' }}
                />
                Next: <span className="font-medium text-foreground">{nextCp.name}</span>
                {' — '}{nextCp.remaining.toLocaleString()} km away
              </div>
            )}
          </>
        )}
      </div>

    </div>
  );
};
