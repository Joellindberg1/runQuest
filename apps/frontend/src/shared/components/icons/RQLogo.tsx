import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

export interface RQLogoProps extends Omit<SVGProps<SVGSVGElement>, "fill"> {
  width?: number;
  height?: number;
  /**
   * Färg på taglinen "RUN - RANK - REIGN". Standard guld; `null` tar bort taglinen.
   * Wordmarken och löparen följer `currentColor`.
   */
  taglineFill?: string | null;
}

/**
 * Wordmarken (löparfigur + RUNQUEST). Enda stället där Oswald (`font-logo`) får förekomma.
 * Geometrin är porterad 1:1 från logo() i runquest-icons.js (viewBox 165x40).
 */
export function RQLogo({
  width = 148,
  height = 36,
  taglineFill = "var(--rq-gold)",
  className,
  ...rest
}: RQLogoProps) {
  return (
    <svg
      viewBox="0 0 165 40"
      width={width}
      height={height}
      fill="currentColor"
      aria-label="RunQuest"
      role="img"
      className={cn("font-logo", className)}
      {...rest}
    >
      <g stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
        <circle cx={23} cy={3.25} r={3.5} fill="currentColor" stroke="none" />
        <line x1={21} y1={8.5} x2={16} y2={20} />
        <line x1={20.5} y1={8.5} x2={27.5} y2={17.5} />
        <line x1={33} y1={13} x2={28.5} y2={16.5} />
        <line x1={19.3} y1={8.7} x2={12} y2={10} />
        <line x1={12} y1={10} x2={10} y2={15} />
        <line x1={16} y1={20} x2={23} y2={23.5} />
        <line x1={23} y1={23.5} x2={20} y2={33} />
        <path d="M16 20 L11 27 Q10 29, 6.5 33.5" fill="none" />
      </g>
      <text x={40} y={25} fontSize={28} letterSpacing="0.5">
        RUNQUEST
      </text>
      {taglineFill && (
        <text x={45} y={40.1} fontSize={12} letterSpacing="0.75" fill={taglineFill}>
          RUN - RANK - REIGN
        </text>
      )}
    </svg>
  );
}
