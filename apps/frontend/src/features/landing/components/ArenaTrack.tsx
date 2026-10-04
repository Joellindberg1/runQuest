import { cssVars } from '@/features/leaderboard/cssVars';
import { ARENA_FINISH, ARENA_LANES, ARENA_TILT_DEG, ARENA_VIEWBOX, ARENA_XP_POP } from '../landingModel';

/**
 * Arena-banan i hjälten: tre banor, tre löpare i olika takt (guld · silver · brons) och en "+50 XP"-pop när guldlöparen
 * passerar mållinjen. Ren dekor (aria-hidden) — rubriken bär budskapet. Löparna följer banan via CSS offset-path +
 * `rqOrbit`, så temafilens globala prefers-reduced-motion stannar dem utan egen kod.
 */
export function ArenaTrack() {
  return (
    <div className="rq-landing-arena" aria-hidden="true">
      <svg className="rq-landing-arena__svg" viewBox={ARENA_VIEWBOX} fill="none" focusable="false" style={cssVars({ '--rq-landing-track-rot': `${ARENA_TILT_DEG}deg` })}>
        {ARENA_LANES.map((lane) => (
          <path key={lane.lane} d={lane.path} className="rq-landing-lane" data-lane={lane.lane} />
        ))}
        <line x1={ARENA_FINISH.x} y1={ARENA_FINISH.y1} x2={ARENA_FINISH.x} y2={ARENA_FINISH.y2} className="rq-landing-finish" />
        {/* Texten roteras tillbaka så den läses upprätt trots att ovalen är vriden. */}
        <g transform={`rotate(${-ARENA_TILT_DEG} ${ARENA_XP_POP.x} ${ARENA_XP_POP.y})`}>
          <text x={ARENA_XP_POP.x} y={ARENA_XP_POP.y} className="rq-landing-xp">{ARENA_XP_POP.label}</text>
        </g>
        {ARENA_LANES.map((lane) => (
          <circle
            key={lane.lane}
            r={lane.runnerRadius}
            className="rq-landing-runner"
            data-lane={lane.lane}
            style={cssVars({ '--rq-lane-path': `path("${lane.path}")` })}
          />
        ))}
      </svg>
    </div>
  );
}
