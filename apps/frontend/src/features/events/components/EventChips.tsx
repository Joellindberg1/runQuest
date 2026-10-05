import type { EventChip } from '../eventsModel';

interface EventChipsProps {
  chips: readonly EventChip[];
  /** Fakta-taggar (`tag`) visas bara på desktop — mobilen bär samma information i regelraden. */
  showTags: boolean;
}

/** Chip-raden på ett eventkort: fakta som taggar, belöningen och "Done" som värdetagg (tint 14 % / kant 50 %). */
export function EventChips({ chips, showTags }: EventChipsProps) {
  const visible = chips.filter((chip) => showTags || chip.tone !== 'tag');
  if (visible.length === 0) return null;
  return (
    <ul className="rq-events-chips" aria-label="Event facts">
      {visible.map((chip) => (
        <li key={chip.key} className={chip.tone === 'tag' ? 'rq-chip rq-chip--tag' : 'rq-chip rq-chip--value'}>
          {chip.label}
        </li>
      ))}
    </ul>
  );
}
