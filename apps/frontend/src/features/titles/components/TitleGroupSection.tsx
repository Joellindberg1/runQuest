import { RQIcon } from '@/shared/components/icons';
import type { TitleGroup } from '../titlesModel';
import { TitleCard } from './TitleCard';

const GROUP_ICON_SIZE = 15;

interface TitleGroupSectionProps {
  group: TitleGroup;
  open: boolean;
  onToggle: () => void;
  /** Desktop ritar en chevron efter antalet (Web-prototypen); mobilen bara antalet. */
  showChevron: boolean;
  displayPositions: ReadonlyMap<string, number>;
  canPick: boolean;
  selectionFull: boolean;
  onTogglePick: (titleId: string) => void;
}

/** En kategori som dragspel: rubrikknapp (ikon, namn, antal) och titelkorten under. */
export function TitleGroupSection({ group, open, onToggle, showChevron, displayPositions, canPick, selectionFull, onTogglePick }: TitleGroupSectionProps) {
  const listId = `titles-group-${group.id}`;
  return (
    <section className="rq-titles-group" aria-label={group.label}>
      <button type="button" className="rq-titles-group__head" aria-expanded={open} aria-controls={listId} onClick={onToggle}>
        <span className="rq-titles-group__id">
          <RQIcon name={group.icon} size={GROUP_ICON_SIZE} />
          <span className="rq-titles-group__label">{group.label}</span>
        </span>
        <span className="rq-titles-group__count">
          {group.count}
          {showChevron && <RQIcon name="chevron" size={GROUP_ICON_SIZE} className="rq-titles-group__chev" />}
        </span>
      </button>
      {open && (
        <ul id={listId} className="rq-titles-list">
          {group.rows.map((row) => {
            const position = displayPositions.get(row.id) ?? null;
            return (
              <TitleCard
                key={row.id}
                row={row}
                displayPosition={position}
                canPick={canPick}
                pickDisabled={position === null && selectionFull}
                onTogglePick={onTogglePick}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
