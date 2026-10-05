import type { CSSProperties } from 'react';

/**
 * Dynamiska värden (stapelbredd, animationsfördröjning) går in som CSS-variabler — aldrig som
 * färg/typ/mått i en inline-style (regel 1). Vakttestet tillåter bara den här vägen.
 */
export function cssVars(vars: Record<`--${string}`, string>): CSSProperties {
  return vars as CSSProperties;
}
