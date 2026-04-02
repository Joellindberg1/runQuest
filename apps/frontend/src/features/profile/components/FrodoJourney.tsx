import React, { useEffect, useRef, useState } from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────

const JOURNEY_END_KM = 3266;

type ZoomLevel = 0 | 1 | 2;

interface Waypoint { name: string; km: number; tier: 1 | 2 }

const ALL_WAYPOINTS: Waypoint[] = [
  // ── Major destinations (tier 1) ──────────────────────────────────────────
  { name: 'The Shire',          km: 0,    tier: 1 },
  { name: 'Bree',               km: 168,  tier: 1 },
  { name: 'Rivendell',          km: 457,  tier: 1 },
  { name: 'Moria',              km: 1181, tier: 1 },
  { name: 'Rauros',             km: 1892, tier: 1 },
  { name: 'The Black Gate',     km: 2680, tier: 1 },
  { name: 'Mount Doom',         km: 3266, tier: 1 },

  // ── The Shire → Bree ─────────────────────────────────────────────────────
  { name: 'Woody End',          km: 34,   tier: 2 },
  { name: 'Bucklebury Ferry',   km: 67,   tier: 2 },
  { name: "Tom Bombadil's",     km: 101,  tier: 2 },
  { name: 'Barrow-downs',       km: 134,  tier: 2 },

  // ── Bree → Rivendell ─────────────────────────────────────────────────────
  { name: 'Midgewater Marshes', km: 226,  tier: 2 },
  { name: 'Weathertop',         km: 284,  tier: 2 },
  { name: 'The Last Bridge',    km: 342,  tier: 2 },
  { name: 'Trollshaws',         km: 399,  tier: 2 },

  // ── Rivendell → Moria ────────────────────────────────────────────────────
  { name: 'Hollin',             km: 602,  tier: 2 },
  { name: 'Caradhras',          km: 747,  tier: 2 },
  { name: 'Doors of Durin',     km: 892,  tier: 2 },
  { name: "Balin's Tomb",       km: 1037, tier: 2 },

  // ── Moria → Rauros ───────────────────────────────────────────────────────
  { name: 'Dimrill Dale',       km: 1323, tier: 2 },
  { name: 'Lothlórien',         km: 1465, tier: 2 },
  { name: 'The Tongue',         km: 1607, tier: 2 },
  { name: 'Argonath',           km: 1749, tier: 2 },

  // ── Rauros → The Black Gate ──────────────────────────────────────────────
  { name: 'Emyn Muil',          km: 2050, tier: 2 },
  { name: 'Dead Marshes',       km: 2208, tier: 2 },
  { name: 'Dagorlad',           km: 2366, tier: 2 },
  { name: 'Morannon',           km: 2524, tier: 2 },

  // ── The Black Gate → Mount Doom ──────────────────────────────────────────
  { name: 'Ithilien',           km: 2797, tier: 2 },
  { name: 'Cirith Ungol',       km: 2914, tier: 2 },
  { name: 'Gorgoroth',          km: 3031, tier: 2 },
  { name: 'Sammath Naur',       km: 3148, tier: 2 },
].sort((a, b) => a.km - b.km);

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getViewport(zoom: ZoomLevel, posKm: number): { start: number; end: number } {
  if (zoom === 0) return { start: 0, end: JOURNEY_END_KM };
  const half = zoom === 1 ? 600 : 200;
  const center = Math.max(half, Math.min(JOURNEY_END_KM - half, posKm));
  return { start: center - half, end: center + half };
}

function pctInView(km: number, start: number, end: number): number {
  return ((km - start) / (end - start)) * 100;
}

function lastCheckpoint(totalKm: number): Waypoint {
  let result = ALL_WAYPOINTS[0];
  for (const wp of ALL_WAYPOINTS) {
    if (totalKm >= wp.km) result = wp;
    else break;
  }
  return result;
}

function nextCheckpointInfo(totalKm: number): { name: string; km: number; remaining: number } | null {
  if (totalKm >= JOURNEY_END_KM) return null;
  const next = ALL_WAYPOINTS.find(wp => wp.km > totalKm);
  if (!next) return null;
  return { name: next.name, km: next.km, remaining: Math.ceil(next.km - totalKm) };
}

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
            className="flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded border border-foreground/20 text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
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
            className="absolute text-[10px] leading-none whitespace-nowrap transition-[left] duration-300 ease-in-out"
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
          className="absolute text-[10px] leading-none font-bold whitespace-nowrap"
          style={{
            top:   belowLabelTop,
            left:  0,
            color: zoom === 0 ? 'var(--rq-success)' : 'color-mix(in srgb, var(--foreground) 40%, transparent)',
          }}
        >
          {startLabel}
        </span>
        <span
          className="absolute text-[10px] leading-none font-bold whitespace-nowrap"
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
            <div className="text-xs text-muted-foreground">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full border-2 border-background align-middle mr-1.5"
                style={{ background: 'var(--rq-gold)', boxShadow: '0 0 4px color-mix(in srgb, var(--rq-gold) 60%, transparent)' }}
              />
              Last checkpoint: <span className="font-medium text-foreground">{checkpoint.name}</span>
            </div>
            {nextCp && (
              <div className="text-xs text-muted-foreground">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full align-middle mr-1.5"
                  style={{ border: '2px solid var(--rq-gold)', background: 'transparent' }}
                />
                Next: <span className="font-medium text-foreground">{nextCp.name}</span>
                {' — '}{nextCp.remaining.toLocaleString()} km away
              </div>
            )}
            <div className="text-xs text-muted-foreground pl-4">
              {((posKm / JOURNEY_END_KM) * 100).toFixed(1)}% · {Math.round(totalKm).toLocaleString()} / {JOURNEY_END_KM.toLocaleString()} km
            </div>
          </>
        )}
      </div>

    </div>
  );
};
