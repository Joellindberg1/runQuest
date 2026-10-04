import { cn } from "@/lib/utils";
import {
  DEFAULT_SPEED_SECONDS,
  DEFAULT_TILT_DEGREES,
  LANE_INSETS,
  LANE_SPEED_FACTORS,
  LANE_STROKE_OPACITY,
  RUNNER_OPACITY,
  TRACK_VIEWBOX_WIDTH,
  laneStrokeWidth,
  ovalPath,
  runnerRadius,
  trackHeight,
  trackLaneCount,
} from "./track-geometry";

export interface TrackLoaderProps {
  /** Bredd i px. Banor/prickar trappas med storleken: <34 → 1, <64 → 2, annars 3. */
  size?: number;
  /** Valfri CSS-färg, helst en token. Standard guld; i guldknapp: `var(--rq-on-gold)`. */
  color?: string;
  /** Sekunder per varv för yttre banan; innerbanorna är långsammare. */
  speed?: number;
  /** Grader. Lutningen får ovalen att läsas som en stadion, inte en pill. */
  tilt?: number;
  /** Skärmläsartext. */
  label?: string;
  className?: string;
}

/**
 * Stadion-ovalen: väntan som läses som löpning (designspråk regel 9).
 * Banorna är statisk SVG; prickarna följer samma oval via CSS offset-path +
 * keyframes `rqOrbit` (temafilen), så det blir skarpt ner till ~26 px.
 * Rörelse hanteras av temafilens globala prefers-reduced-motion.
 */
export function TrackLoader({
  size = 48,
  color = "var(--rq-gold)",
  speed = DEFAULT_SPEED_SECONDS,
  tilt = DEFAULT_TILT_DEGREES,
  label = "Loading",
  className,
}: TrackLoaderProps) {
  const height = trackHeight(size);
  const lanes = trackLaneCount(size);
  const scale = size / TRACK_VIEWBOX_WIDTH;
  const laneIndexes = Array.from({ length: lanes }, (_, i) => i);
  const dotRadius = runnerRadius(size);

  return (
    <div
      role="status"
      aria-label={label}
      className={cn("relative shrink-0", className)}
      style={{ width: size, height, transform: `rotate(${tilt}deg)` }}
    >
      <svg
        viewBox={`0 0 ${TRACK_VIEWBOX_WIDTH} 62`}
        width={size}
        height={height}
        aria-hidden="true"
        className="absolute inset-0 block"
      >
        {laneIndexes.map((i) => (
          <path
            key={i}
            d={ovalPath(LANE_INSETS[i])}
            fill="none"
            stroke={color}
            strokeOpacity={LANE_STROKE_OPACITY[i]}
            strokeWidth={laneStrokeWidth(size)}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {laneIndexes.map((i) => (
        <div
          key={i}
          aria-hidden="true"
          className="absolute left-0 top-0 rounded-full"
          style={{
            width: dotRadius * 2,
            height: dotRadius * 2,
            marginLeft: -dotRadius,
            marginTop: -dotRadius,
            background: color,
            opacity: RUNNER_OPACITY[i],
            offsetPath: `path("${ovalPath(LANE_INSETS[i], scale)}")`,
            animation: `rqOrbit ${speed * LANE_SPEED_FACTORS[i]}s linear infinite`,
            animationDelay: `${-i * 0.7}s`,
          }}
        />
      ))}
    </div>
  );
}
