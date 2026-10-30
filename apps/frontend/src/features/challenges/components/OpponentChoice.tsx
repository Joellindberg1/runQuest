import { useRef, type KeyboardEvent } from 'react';
import type { OpponentOption } from '../sendModel';

interface OpponentChoiceProps {
  options: readonly OpponentOption[];
  /** Den valda motståndaren; null = ingen (då är första valbara raden tabbstoppet). */
  selectedId: string | null;
  /** Id på rubriken som ger gruppen dess namn. */
  labelledBy: string;
  onSelect: (userId: string) => void;
}

/** Närmaste rad som går att välja i riktningen `step` (1 eller -1), med omslag; null om ingen går att välja. */
function nextChoosable(options: readonly OpponentOption[], from: number, step: 1 | -1): number | null {
  const count = options.length;
  for (let distance = 1; distance <= count; distance += 1) {
    const index = (((from + step * distance) % count) + count) % count;
    if (!options[index].disabled) return index;
  }
  return null;
}

function targetIndex(key: string, from: number, options: readonly OpponentOption[]): number | null {
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return nextChoosable(options, from, 1);
    case 'ArrowUp':
    case 'ArrowLeft':
      return nextChoosable(options, from, -1);
    case 'Home':
      return nextChoosable(options, -1, 1);
    case 'End':
      return nextChoosable(options, options.length, -1);
    default:
      return null;
  }
}

function OpponentRow({ option, checked, tabStop, onSelect, onKeyDown, buttonRef }: {
  option: OpponentOption;
  checked: boolean;
  tabStop: boolean;
  onSelect: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  buttonRef: (element: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      role="radio"
      aria-checked={checked}
      // Avstängd med aria-disabled (inte `disabled`): raden finns kvar för hjälpmedel, och orsaken är en del av dess namn.
      aria-disabled={option.disabled || undefined}
      tabIndex={tabStop ? 0 : -1}
      className="rq-duels-option rq-duels-option--opponent"
      onClick={() => { if (!option.disabled) onSelect(); }}
      onKeyDown={onKeyDown}
    >
      <span className="rq-avatar rq-duels-avatar">
        {option.pictureUrl ? <img src={option.pictureUrl} alt="" /> : option.initials}
      </span>
      <span className="rq-duels-option__text">
        <span className="rq-name">{option.name}</span>
        {option.disabledReason ? (
          <span className="rq-duels-option__note rq-duels-option__reason">{option.disabledReason}</span>
        ) : (
          <span className="rq-duels-option__note">{option.note}</span>
        )}
      </span>
      {option.h2h && <span className="rq-duels-option__h2h" data-tone={option.h2h.tone}>{option.h2h.text}</span>}
    </button>
  );
}

/**
 * Send-flödets steg 3: motståndarna som en radiogrupp, som tokenkorten i steg 2. Ett tabbstopp (den valda raden, annars första som går att välja),
 * pilarna flyttar både valet och fokus och hoppar över dem som inte går att utmana, Home/End hoppar till första/sista valbara, Space och Enter väljer.
 * En motståndare i en duell eller med en väntande utmaning är aria-disabled och visar orsaken i stället för nivå och placering. Head to head-tipset
 * står kvar på raden. Jag själv finns aldrig i listan (`buildOpponents`).
 */
export function OpponentChoice({ options, selectedId, labelledBy, onSelect }: OpponentChoiceProps) {
  const rows = useRef<Array<HTMLButtonElement | null>>([]);

  if (options.length === 0) return <p className="rq-duels-note">Nobody else is in your group yet.</p>;

  const tabStopId = options.find((option) => option.userId === selectedId && !option.disabled)?.userId ?? options.find((option) => !option.disabled)?.userId ?? null;

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = targetIndex(event.key, index, options);
    if (next === null) return;
    event.preventDefault();
    onSelect(options[next].userId);
    rows.current[next]?.focus();
  };

  return (
    <div className="rq-hairgrid rq-duels-opponents" role="radiogroup" aria-labelledby={labelledBy}>
      {options.map((option, index) => (
        <OpponentRow
          key={option.userId}
          option={option}
          checked={option.userId === selectedId}
          tabStop={option.userId === tabStopId}
          buttonRef={(element) => { rows.current[index] = element; }}
          onSelect={() => onSelect(option.userId)}
          onKeyDown={(event) => onKeyDown(event, index)}
        />
      ))}
    </div>
  );
}
