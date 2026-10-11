import { MAX_SHOWCASE } from '@runquest/shared';
import { RQIcon } from '@/shared/components/icons';
import type { BadgeRow } from '../badgeModel';
import { BadgeEmblem } from './BadgeEmblem';
import '../badges.css';

const REMOVE_ICON_SIZE = 15;
const SLOT_NUMBERS = Array.from({ length: MAX_SHOWCASE }, (_, index) => index + 1);

interface ShowcaseSlotsProps {
  /** De valda serierna i vald ordning (platsnummer = index + 1). */
  selected: readonly BadgeRow[];
  /** Spärrar ✕ medan ett val sparas. */
  busy: boolean;
  onRemove: (series: string) => void;
}

/**
 * Platspanelen i väljaren (spec F3 steg 3): alltid tre platser, fyllda i valordning, resten som tomma streckade platser ("0/3 och 2/3 använder samma tomma plats").
 * Platsmarkören är `--rq-titles-pos` (19 px); ✕ har en etikett med serienamnet och tryckyta ur `--rq-badge-pick-hit` (44 px mobil, 24 desktop).
 * Nivån står som text bredvid namnet — den bärs aldrig av färg ensam.
 */
export function ShowcaseSlots({ selected, busy, onRemove }: ShowcaseSlotsProps) {
  return (
    <ol className="rq-badge-slots" aria-label="Badges on display">
      {SLOT_NUMBERS.map((number) => {
        const row = selected[number - 1];
        if (!row) {
          return (
            <li key={number} className="rq-badge-slot" data-empty="true">
              <span className="rq-badge-slot__pos" aria-hidden="true">{number}</span>
              <span className="rq-badge-slot__empty">Empty slot</span>
            </li>
          );
        }
        return (
          <li key={row.series} className="rq-badge-slot">
            <span className="rq-badge-slot__pos" aria-hidden="true">{number}</span>
            <BadgeEmblem series={row.series} tier={row.tier} size="sm" decorative />
            <span className="rq-badge-slot__text">
              <span className="rq-badge-slot__name">{row.name}</span>
              <span className="rq-badge-slot__tier">{row.tierName}</span>
            </span>
            <button type="button" className="rq-badge-slot__remove" aria-label={`Remove ${row.name} from display`} disabled={busy} onClick={() => onRemove(row.series)}>
              <RQIcon name="plus" size={REMOVE_ICON_SIZE} />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
