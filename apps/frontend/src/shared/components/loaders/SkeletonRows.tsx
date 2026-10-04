import { cn } from "@/lib/utils";

export interface SkeletonRowsProps {
  /** Antal rader. */
  rows?: number;
  /** Skärmläsartext. */
  label?: string;
  className?: string;
}

/** Namnstreckets bredd varierar rad för rad så skelettet inte läses som en tabell av klonar. */
const NAME_WIDTHS = ["62%", "48%", "70%", "40%"] as const;
const BLINK_STAGGER_SECONDS = 0.15;

const blockBase = "animate-[rqBlink_1.5s_ease-in-out_infinite]";

/**
 * Skeleton för listor som anländer rad för rad (leaderboard, run history).
 * Hårlinjegrid (regel 6): raderna skiljs av 1 px gap, inga kanter, ingen zebra.
 * Radhöjden följer riktiga rader (`--rq-pad-row-*`) så inget hoppar när datan kommer.
 * Kolumner: rank (34 px) · namn + stapel · värde (90 px, guldtint).
 */
export function SkeletonRows({ rows = 4, label = "Loading", className }: SkeletonRowsProps) {
  return (
    <div role="status" aria-label={label} className={cn("rq-hairgrid", className)}>
      {Array.from({ length: rows }, (_, i) => {
        const delay = { animationDelay: `${i * BLINK_STAGGER_SECONDS}s` };
        return (
          <div
            key={i}
            aria-hidden="true"
            className="grid grid-cols-[34px_1fr_90px] items-center gap-[var(--rq-sp-14)] bg-[var(--rq-row)] px-[var(--rq-pad-row-x)] py-[var(--rq-pad-row-y)]"
          >
            <div className={cn(blockBase, "h-[22px] bg-[var(--rq-fill-1)]")} style={delay} />
            <div>
              <div
                className={cn(blockBase, "h-[13px] bg-[var(--rq-fill-1)]")}
                style={{ ...delay, width: NAME_WIDTHS[i % NAME_WIDTHS.length] }}
              />
              <div className={cn(blockBase, "mt-[var(--rq-sp-8)] h-[5px] bg-[var(--rq-fill-1)]")} style={delay} />
            </div>
            <div
              className={cn(blockBase, "h-[14px] bg-[rgb(var(--rq-gold-rgb)/var(--rq-tint-status))]")}
              style={delay}
            />
          </div>
        );
      })}
    </div>
  );
}
