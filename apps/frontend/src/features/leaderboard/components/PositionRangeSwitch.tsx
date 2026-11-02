import { SegmentedControl } from '@/shared/components/SegmentedControl';
import { POSITION_RANGE_LABEL, POSITION_RANGE_OPTIONS, type PositionRange } from '../positionRange';

interface PositionRangeSwitchProps {
  value: PositionRange;
  onChange: (next: PositionRange) => void;
}

/**
 * Växeln Last 8 weeks / All time över positionsgrafen, på Board och på profilen: den segmenterade kontrollen (aria-pressed) med ett tabbstopp och piltangenter. Den byter vy av samma
 * innehåll, så den är en knappgrupp och ingen tablist.
 */
export function PositionRangeSwitch({ value, onChange }: PositionRangeSwitchProps) {
  return <SegmentedControl label={POSITION_RANGE_LABEL} options={POSITION_RANGE_OPTIONS} value={value} onChange={onChange} roving />;
}
