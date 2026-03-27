import React from 'react';

// ─── LOTR journey constants ────────────────────────────────────────────────────

const JOURNEY_END_KM = 3266;

interface Waypoint { name: string; km: number; row?: 0 | 1; color?: string }

const ALL_WAYPOINTS: Waypoint[] = [
  { name: 'The Shire',      km: 0 },
  { name: 'Bree',           km: 168,            row: 1 },
  { name: 'Rivendell',      km: 457,            row: 0 },
  { name: 'Moria',          km: 1181,           row: 1 },
  { name: 'Rauros',         km: 1892,           row: 0 },
  { name: 'The Black Gate', km: 2680,           row: 1 },
  { name: 'MORDOR',         km: JOURNEY_END_KM },
];

// Intermediate checkpoints rendered above the bar (row required)
const ABOVE_WAYPOINTS = ALL_WAYPOINTS.filter(
  (w): w is Waypoint & { row: 0 | 1 } => w.km > 0 && w.km < JOURNEY_END_KM && w.row !== undefined,
);

// Pixel layout
//   y=0 ─────────────────────────── far labels (row 1)
//   y=topH-gap[1]-labelH
//   ...
//   y=topH-gap[0]-labelH ────────── close labels (row 0)
//   y=topH ─────────────────────── BAR ──────────────
//   y=topH+barH+belowMargin ─────── "The Shire" / "MORDOR"
const J = {
  topH:        56,
  barH:        10,
  belowMargin: 5,
  belowH:      16,
  gap:         [16, 40] as [number, number],
  labelH:      12,
  totalH:      87,
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pctOf(km: number) {
  return Math.min((km / JOURNEY_END_KM) * 100, 100);
}

function lastCheckpoint(totalKm: number): string {
  let result = ALL_WAYPOINTS[0].name;
  for (const wp of ALL_WAYPOINTS) {
    if (totalKm >= wp.km) result = wp.name;
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

// ─── Component ────────────────────────────────────────────────────────────────

export const FrodoJourney: React.FC<{ totalKm: number }> = ({ totalKm }) => {
  const pct        = pctOf(totalKm);
  const done       = totalKm >= JOURNEY_END_KM;
  const checkpoint = lastCheckpoint(totalKm);
  const nextCp     = nextCheckpointInfo(totalKm);

  const computed = ABOVE_WAYPOINTS.map(w => {
    const gap      = J.gap[w.row];
    const labelTop = J.topH - gap - J.labelH;
    const tickTop  = J.topH - gap;
    return { ...w, labelTop, tickTop, tickH: gap };
  });

  const belowLabelTop = J.topH + J.barH + J.belowMargin;

  return (
    <div className="select-none">
      <div
        className="text-xs font-semibold mb-2"
        style={{ color: 'var(--rq-gold)', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.12em' }}
      >
        AS FRODO
      </div>

      <div className="relative w-full" style={{ height: J.totalH }}>

        {/* Above-bar labels (intermediate checkpoints) */}
        {computed.map(w => (
          <span
            key={w.name}
            className="absolute text-[10px] leading-none whitespace-nowrap"
            style={{
              top: w.labelTop,
              left: `${pctOf(w.km)}%`,
              transform: 'translateX(-50%)',
              color: 'color-mix(in srgb, var(--foreground) 50%, transparent)',
            }}
          >
            {w.name}
          </span>
        ))}

        {/* Ticks — connect bar top up to label bottom */}
        {computed.map(w => (
          <div
            key={`tick-${w.name}`}
            className="absolute pointer-events-none"
            style={{
              top: w.tickTop,
              height: w.tickH,
              left: `${pctOf(w.km)}%`,
              width: 1,
              background: `linear-gradient(to bottom, color-mix(in srgb, var(--rq-gold) 50%, transparent), color-mix(in srgb, var(--rq-gold) 80%, transparent))`,
            }}
          />
        ))}

        {/* Bar */}
        <div
          className="absolute left-0 right-0 rounded-full bg-foreground/10 overflow-visible"
          style={{ top: J.topH, height: J.barH }}
        >
          <div
            className="absolute h-full rounded-l-full"
            style={{ width: `${pct}%`, background: 'var(--rq-gold)' }}
          />

          {/* Current position needle (filled gold) */}
          {!done && pct > 0 && (
            <div
              className="absolute w-3 h-3 rounded-full border-2 border-background pointer-events-none"
              style={{
                left: `${pct}%`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
                background: 'var(--rq-gold)',
                boxShadow: '0 0 7px color-mix(in srgb, var(--rq-gold) 70%, transparent)',
              }}
            />
          )}

          {/* Next checkpoint needle (hollow ring) */}
          {nextCp && (
            <div
              className="absolute w-3 h-3 rounded-full pointer-events-none"
              style={{
                left: `${pctOf(nextCp.km)}%`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
                border: '2px solid var(--rq-gold)',
                background: 'var(--background)',
                opacity: 0.7,
              }}
            />
          )}
        </div>

        {/* Below-bar labels: The Shire (left) and MORDOR (right) */}
        <span
          className="absolute text-[10px] leading-none font-bold whitespace-nowrap"
          style={{ top: belowLabelTop, left: 0, color: 'var(--rq-success)' }}
        >
          The Shire
        </span>
        <span
          className="absolute text-[10px] leading-none font-bold whitespace-nowrap"
          style={{ top: belowLabelTop, right: 0, color: 'var(--rq-danger)' }}
        >
          MORDOR
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
              Last checkpoint: <span className="font-medium text-foreground">{checkpoint}</span>
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
              {pct.toFixed(1)}% done · {Math.round(totalKm).toLocaleString()} / {JOURNEY_END_KM.toLocaleString()} km
            </div>
          </>
        )}
      </div>
    </div>
  );
};
