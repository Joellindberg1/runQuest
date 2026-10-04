import { cssVars } from '@/features/leaderboard/cssVars';

interface CountdownRingProps {
  time: string;
  label: string;
  /** Andel av fönstret som återstår (0–1). */
  fraction: number;
  settling: boolean;
}

/** Nedräkningen i en ring (cirkel är tillåten för ringar, regel 2). Texten är innehållet; ringens fyllnad är dekor. */
export function CountdownRing({ time, label, fraction, settling }: CountdownRingProps) {
  return (
    <div
      className="rq-ring rq-events-ring"
      data-state={settling ? 'settling' : 'open'}
      style={cssVars({ '--rq-ring-p': `${fraction.toFixed(4)}turn` })}
    >
      <div className="rq-ring-hole">
        <span className="rq-events-ring__time">{time}</span>
        <span className="rq-events-ring__label">{label}</span>
      </div>
    </div>
  );
}
