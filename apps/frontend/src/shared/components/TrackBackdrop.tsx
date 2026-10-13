import './track-backdrop.css';

/**
 * Bakgrunden bakom alla sidor i appen och på /legal (Web Prototype, `showTrackBg`): guldrutnätet som glider sakta uppåt och banan nere
 * till höger med tre löpare (guld, silver, brons). Ren dekor: aria-hidden, tar aldrig emot pekare och har inget eget z-index. Den
 * monteras FÖRST i sin ram, och innehållet efter den är positionerat (`position: relative`), så sidan ritas ovanpå i trädordning.
 * Löparna är HTML-element som rör sig med CSS-keyframes på transform (rqTrackLap1–3; inte SMIL och inte SVG-element, som ger layout varje
 * bildruta), så `prefers-reduced-motion` kan stänga av dem. Mått, färger och tider är tokens (--rq-track-bg-*); bara banans geometri ligger här,
 * i user units i en viewBox som skalar med SVG:n (och som keyframesen i temafilen räknar i).
 */

/** Prototypens viewBox, lika stor som banans ruta (--rq-track-bg-vb-w × -vb-h); storleken i sidan är --rq-track-bg-scale. */
const VIEWBOX = '0 0 1400 760';

/** Fyra ovaler, innerst först. De tre första bär en löpare var (lane 1 = guld). */
const LANES = [
  { lane: 1, path: 'M340 230 H1060 A150 150 0 0 1 1060 530 H340 A150 150 0 0 1 340 230 Z' },
  { lane: 2, path: 'M340 196 H1060 A184 184 0 0 1 1060 564 H340 A184 184 0 0 1 340 196 Z' },
  { lane: 3, path: 'M340 162 H1060 A218 218 0 0 1 1060 598 H340 A218 218 0 0 1 340 162 Z' },
  { lane: 4, path: 'M340 128 H1060 A252 252 0 0 1 1060 632 H340 A252 252 0 0 1 340 128 Z' },
] as const;

/** Mållinjen över de tre inre banorna. */
const FINISH = { x: 700, y1: 524, y2: 636 } as const;

/** Löparna (guld, silver, brons): diameter, fyllning, varv, fördröjning och vilopunkt per löpare ligger i track-backdrop.css och temafilen. */
const RUNNERS = [1, 2, 3] as const;

export function TrackBackdrop() {
  return (
    <div className="rq-track-bg" data-decor="track-backdrop" aria-hidden="true">
      <div className="rq-track-bg__grid" />
      <div className="rq-track-bg__track">
        <svg className="rq-track-bg__svg" viewBox={VIEWBOX} fill="none" focusable="false">
          {LANES.map(({ lane, path }) => (
            <path key={lane} d={path} className="rq-track-bg__lane" data-lane={lane} />
          ))}
          <line x1={FINISH.x} y1={FINISH.y1} x2={FINISH.x} y2={FINISH.y2} className="rq-track-bg__finish" data-finish="" />
        </svg>
        {RUNNERS.map((runner) => (
          <span key={runner} className="rq-track-bg__runner" data-runner={runner} />
        ))}
      </div>
    </div>
  );
}
