import { RQIcon } from '@/shared/components/icons';
import type { TitleRow } from '../titlesModel';

const ICON_SIZE = 15;
const DISPLAY_FULL_HINT = 'Display is full — remove one first';

interface TitleCardProps {
  row: TitleRow;
  /** Plats i visningsvalet (1–3) om titeln är vald, annars null. */
  displayPosition: number | null;
  /** Visas bara på mina titlar och bara när valet har hunnit laddas. */
  canPick: boolean;
  /** Valet är fullt och den här titeln står utanför det. */
  pickDisabled: boolean;
  onTogglePick: (titleId: string) => void;
}

/** En titel: namn, regel, innehavare + värde, runner-ups #2/#3 — eller "Nobody yet" med bästa försöket (olåst). */
export function TitleCard({ row, displayPosition, canPick, pickDisabled, onTogglePick }: TitleCardProps) {
  const unclaimed = row.state === 'unclaimed';
  return (
    <li className="rq-card rq-card--edge rq-titles-card" data-state={row.state}>
      <div className="rq-titles-card__head">
        <RQIcon name={row.icon} size={ICON_SIZE} />
        <h3 className="rq-titles-card__name">{row.name}</h3>
      </div>
      <p className="rq-titles-card__rule">{row.rule}</p>

      <div className="rq-titles-card__holder">
        {row.holder ? (
          <span className="rq-titles-holder" data-mine={row.holder.mine}>
            <RQIcon name="crown" size={ICON_SIZE} />
            <span>{row.holder.name}</span>
          </span>
        ) : (
          <span className="rq-titles-holder" data-empty="true">
            Nobody yet
          </span>
        )}
        <span className="rq-titles-card__value">{row.holder?.value ?? '—'}</span>
      </div>

      {row.runnersUp.length > 0 && (
        <ul className="rq-titles-ups" aria-label="Runners-up">
          {row.runnersUp.map((runner) => (
            <li key={runner.position} className="rq-titles-up" data-mine={runner.mine}>
              <span>
                #{runner.position} {runner.name}
              </span>
              <span>{runner.value}</span>
            </li>
          ))}
        </ul>
      )}

      {unclaimed && row.bestSoFar && (
        <ul className="rq-titles-ups" aria-label="Best so far">
          <li className="rq-titles-up">
            <span>Best so far · {row.bestSoFar.name}</span>
            <span>{row.bestSoFar.value}</span>
          </li>
        </ul>
      )}
      {unclaimed && row.unlock && <p className="rq-titles-card__unlock">Unlocks at {row.unlock}</p>}

      {canPick && row.state === 'mine' && (
        <button
          type="button"
          className="rq-titles-pick"
          aria-pressed={displayPosition !== null}
          disabled={pickDisabled}
          title={pickDisabled ? DISPLAY_FULL_HINT : undefined}
          onClick={() => onTogglePick(row.id)}
        >
          {displayPosition !== null ? `On display · ${displayPosition}` : 'Show on leaderboard'}
          {pickDisabled && <span className="sr-only"> — {DISPLAY_FULL_HINT}</span>}
        </button>
      )}
    </li>
  );
}
