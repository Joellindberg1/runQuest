import { cssVars } from '@/features/leaderboard/cssVars';
import { ARENA, ARENA_VIEWBOX, type ArenaGeometry } from '../landingModel';

type ArenaVariant = keyof typeof ARENA;

function ArenaSvg({ variant, geometry }: { variant: ArenaVariant; geometry: ArenaGeometry }) {
  const laneOf = (lane: number) => geometry.lanes.find((candidate) => candidate.lane === lane) ?? geometry.lanes[0];

  return (
    <svg
      className="rq-landing-arena__svg"
      data-arena={variant}
      viewBox={ARENA_VIEWBOX}
      fill="none"
      focusable="false"
      style={cssVars({ '--rq-landing-track-rot': `${geometry.tiltDeg}deg` })}
    >
      {geometry.lanes.map((lane) => (
        <path key={lane.lane} d={lane.path} className="rq-landing-lane" data-lane={lane.lane} style={cssVars({ '--rq-lane-alpha': String(lane.alpha) })} />
      ))}
      <line x1={geometry.finish.x} y1={geometry.finish.y1} x2={geometry.finish.x} y2={geometry.finish.y2} className="rq-landing-finish" />
      {geometry.runners.map((runner) => {
        const { pop } = runner;
        if (!pop) return null;
        // Mobilens oval är vriden nästan lodrätt, så texten roteras tillbaka och läses upprätt; desktops −31° läses som den är.
        const upright = geometry.popUpright ? `rotate(${-geometry.tiltDeg} ${pop.x} ${pop.y})` : undefined;
        return (
          <g key={runner.n} transform={upright}>
            <text x={pop.x} y={pop.y} textAnchor={geometry.popAnchor} className="rq-landing-xp" data-runner={runner.n}>{pop.label}</text>
          </g>
        );
      })}
      {geometry.runners.map((runner) => (
        <circle
          key={runner.n}
          r={runner.radius}
          className="rq-landing-runner"
          data-runner={runner.n}
          style={cssVars({ '--rq-lane-path': `path("${laneOf(runner.lane).path}")` })}
        />
      ))}
    </svg>
  );
}

/**
 * Arena-banan i hjälten. Desktop: fem banor, sex löpare som var och en poppar sitt XP-belopp när de passerar mållinjen. Mobil: tre banor,
 * tre löpare (guld · silver · brons) och en "+50 XP"-pop för guldlöparen. Ren dekor (aria-hidden) — rubriken bär budskapet.
 * Båda banorna ligger i HTML (förrenderingen vet inte bredden) och CSS visar en från 1024 px; den dolda är display: none, så dess löpare
 * och XP-popar kör inga animationer. Löparna följer banan via CSS offset-path + `rqOrbit`, så temafilens globala prefers-reduced-motion
 * stannar dem utan egen kod (de står då i spridda vilopositioner). Geometrin ligger i landingModel; varv och färger per löpare i landing.css.
 */
export function ArenaTrack() {
  return (
    <div className="rq-landing-arena" data-decor="arena" aria-hidden="true">
      <ArenaSvg variant="mobile" geometry={ARENA.mobile} />
      <ArenaSvg variant="desktop" geometry={ARENA.desktop} />
    </div>
  );
}
