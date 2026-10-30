import type { MouseEvent } from 'react';
import { RQIcon } from '@/shared/components/icons';
import { PENNANT_PATH, PENNANT_TEXT_X, PENNANT_TEXT_Y, PENNANT_VIEW_BOX } from '@/shared/components/challengeMark';
import { firstName, restOfName } from '@/shared/utils/format';
import { deltaLabel, type DeltaView } from '../boardFormat';
import { titleLine, type SeasonRow, type TierTokens } from '../seasonModel';

const ICON_CROWN = 15;

// Småkomponenter som Season-, Week- och Streaks-vyerna delar.

/** Krona + de visade titlarna ("A, B & C"); radbryts i stället för att kapas. */
export function TitleLine({ row }: { row: Pick<SeasonRow, 'titleNames' | 'heldTitleCount'> }) {
  return (
    <div className="rq-board-titleline" data-empty={row.titleNames.length === 0}>
      <RQIcon name="crown" size={ICON_CROWN} />
      <span>{titleLine(row.titleNames, row.heldTitleCount)}</span>
    </div>
  );
}

export function RunnerAvatar({ initials, pictureUrl }: { initials: string; pictureUrl: string | null }) {
  return (
    <span className="rq-avatar rq-board-avatar">
      {pictureUrl ? <img src={pictureUrl} alt="" /> : initials}
    </span>
  );
}

/** ▲ 2 / ▼ 1 / — (positivt rank_delta = klättrat). Riktningen går att läsa av skärmläsare. */
export function DeltaMark({ delta }: { delta: DeltaView }) {
  return (
    <span className="rq-board-delta" data-dir={delta.direction} role="img" aria-label={deltaLabel(delta)}>
      {delta.text}
    </span>
  );
}

interface RunnerNameProps {
  userId: string;
  name: string;
  onOpen: () => void;
  /** Mobilens podium: förnamn och efternamn i var sin ruta, så pilen kan stå vid förnamnet och efternamnet få en egen rad. Knappens text är fortfarande hela namnet. */
  split?: boolean;
}

/**
 * Namnet är den fokuserbara ingången till Runner card; hela kortet/raden är dessutom klickbar för
 * pekare. stopPropagation hindrar att ett klick på namnet navigerar två gånger.
 */
export function RunnerName({ userId, name, onOpen, split = false }: RunnerNameProps) {
  const open = (event: MouseEvent) => {
    event.stopPropagation();
    onOpen();
  };
  return (
    <button type="button" className="rq-name rq-board-namebtn" data-runner-id={userId} onClick={open}>
      {split ? <SplitName name={name} /> : name}
    </button>
  );
}

function SplitName({ name }: { name: string }) {
  const surname = restOfName(name);
  return (
    <>
      <span className="rq-board-podium__given">{firstName(name)}</span>
      {surname && (
        <>
          {' '}
          <span className="rq-board-podium__surname">{surname}</span>
        </>
      )}
    </>
  );
}

const TIER_ORDER = ['minor', 'major', 'legendary'] as const;

/** Osända challenge-tokens som vimplar (minor/major/legendary), bara de nivåer som finns. */
export function ChallengeRibbons({ tokens }: { tokens: TierTokens }) {
  const present = TIER_ORDER.filter((tier) => tokens[tier] > 0);
  if (present.length === 0) return null;
  const summary = present.map((tier) => `${tokens[tier]} ${tier}`).join(', ');
  return (
    <span className="rq-ribbons" role="img" aria-label={`Challenges to send: ${summary}`}>
      {present.map((tier) => (
        <svg key={tier} className="rq-ribbon" data-tier={tier} viewBox={PENNANT_VIEW_BOX} aria-hidden="true">
          <path d={PENNANT_PATH} />
          <text x={PENNANT_TEXT_X} y={PENNANT_TEXT_Y} textAnchor="middle">{tokens[tier]}</text>
        </svg>
      ))}
    </span>
  );
}
