import type { SVGProps } from "react";
import { cn } from "@/lib/utils";
import { RQ_ICON_FALLBACK, RQ_ICON_PATHS, type RQIconName } from "./rq-icon-paths";

/** Linjetjockleken är en del av ikongrammatiken (temafilen: --rq-icon-stroke). */
const ICON_STROKE_WIDTH = 1.9;
const CIRCLE_PREFIX = "@";

export interface RQIconProps extends Omit<SVGProps<SVGSVGElement>, "name" | "color"> {
  name: RQIconName;
  /** px — designen använder 15 (rader), 17 (headers), 21 (klockan). */
  size?: number;
  /** Valfri CSS-färg, helst en token: `var(--rq-gold)`. Standard: ärver `currentColor`. */
  color?: string;
}

function renderShape(shape: string, index: number) {
  if (shape.startsWith(CIRCLE_PREFIX)) {
    const [cx, cy, r] = shape.slice(CIRCLE_PREFIX.length).split(" ");
    return <circle key={index} cx={cx} cy={cy} r={r} />;
  }
  return <path key={index} d={shape} />;
}

/**
 * Enda källan för nya ikoner (24x24, stroke 1.9, runda ändar, ingen fyllning).
 * Okänt namn faller tillbaka på trophy i stället för att rendera ingenting.
 * Dekorativ som standard (`aria-hidden`); skicka `aria-label` + `aria-hidden={false}` för en meningsbärande ikon.
 */
export function RQIcon({ name, size = 16, color, className, ...rest }: RQIconProps) {
  const shapes: readonly string[] = RQ_ICON_PATHS[name] ?? RQ_ICON_PATHS[RQ_ICON_FALLBACK];

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color ?? "currentColor"}
      strokeWidth={ICON_STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("shrink-0", className)}
      {...rest}
    >
      {shapes.map(renderShape)}
    </svg>
  );
}
