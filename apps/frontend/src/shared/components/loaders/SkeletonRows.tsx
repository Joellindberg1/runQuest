import { cn } from "@/lib/utils";

export interface SkeletonRowsProps {
  /** Antal rader. */
  rows?: number;
  /** Text för skärmläsare (role=status annonserar innehåll, inte aria-label). */
  label?: string;
  className?: string;
}

/** Namnstreckets bredd varierar rad för rad så skelettet inte läses som en tabell av klonar. */
const NAME_WIDTHS = ["62%", "48%", "70%", "40%"] as const;
const BLINK_STAGGER_SECONDS = 0.15;

/**
 * Skeleton för listor som anländer rad för rad (leaderboard, run history).
 * Hårlinjegrid (regel 6): raderna skiljs av 1 px gap, inga kanter, ingen zebra.
 * Måtten kommer ur temafilens --rq-skel-*-tokens och radens padding ur
 * --rq-pad-row-*, så skelettet har samma höjd som riktiga rader.
 * Kolumner: rank · namn + stapel · värde (guldtint).
 */
export function SkeletonRows({ rows = 4, label = "Loading", className }: SkeletonRowsProps) {
  return (
    <div role="status" className={className}>
      <span className="sr-only">{label}</span>
      <div className="rq-hairgrid" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => {
          const delay = { animationDelay: `${i * BLINK_STAGGER_SECONDS}s` };
          return (
            <div key={i} className="rq-skel-row">
              <div className={cn("rq-skel-block", "h-[var(--rq-skel-h-1)]")} style={delay} />
              <div>
                <div
                  className={cn("rq-skel-block", "h-[var(--rq-skel-h-2)]")}
                  style={{ ...delay, width: NAME_WIDTHS[i % NAME_WIDTHS.length] }}
                />
                <div className={cn("rq-skel-block", "mt-[var(--rq-sp-8)] h-[var(--rq-skel-h-3)]")} style={delay} />
              </div>
              <div className={cn("rq-skel-block rq-skel-block--value", "h-[var(--rq-skel-h-4)]")} style={delay} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
