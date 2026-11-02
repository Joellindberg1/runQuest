import { POSITION_WEEKS_ALL_TIME, POSITION_WEEKS_DEFAULT } from '@runquest/shared';
import type { SegmentedOption } from '@/shared/components/SegmentedControl';

// De två vyerna i Position-fliken, på Board och på profilen: de senaste åtta veckorna (standard, samma som innan växeln fanns) och "All time" (hela säsongen; utan säsonger än = sedan gruppen
// började). Valet är ett vanligt tillstånd i fliken och nollställs när fliken öppnas igen; inget skrivs i adressen. Antalet veckor per vy är EN tabell här, så att båda flikarna ber om samma sak.

export type PositionRange = 'last-weeks' | 'all-time';

export const DEFAULT_POSITION_RANGE: PositionRange = 'last-weeks';

/** Skärmläsarnamnet på växeln. */
export const POSITION_RANGE_LABEL = 'Position range';

export const POSITION_RANGE_OPTIONS: readonly SegmentedOption<PositionRange>[] = [
  { value: 'last-weeks', label: `Last ${POSITION_WEEKS_DEFAULT} weeks` },
  { value: 'all-time', label: 'All time' },
];

const WEEKS_OF_RANGE: Record<PositionRange, number> = {
  'last-weeks': POSITION_WEEKS_DEFAULT,
  'all-time': POSITION_WEEKS_ALL_TIME,
};

/** Antalet veckor som vyn begär. Svaret kan ha färre: servern beskär veckor före första medlemmen. */
export function positionWeeksFor(range: PositionRange): number {
  return WEEKS_OF_RANGE[range];
}
