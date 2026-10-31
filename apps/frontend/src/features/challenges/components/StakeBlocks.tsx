import { NO_BREAK_SPACE, keepDurationsTogether, type Stake } from '../duelsFormat';

interface StakeBlocksProps {
  stake: Stake;
  winLabel: string;
  loseLabel: string;
  /** Hårlinje ovanför (live-kortets Win/Lose-fot). */
  ruled?: boolean;
}

/** Längden ("14 d") hålls ihop med snedstrecket: en smal cell bryts före "/", aldrig inom varaktigheten. Texten är samma, bara mellanslagen är hårda. */
const keepDurationTogether = (text: string): string => keepDurationsTogether(text.replace(/ \/ (?=\d)/, ` /${NO_BREAK_SPACE}`));

/** Vinst och förlust som två celler: grön vinst, röd förlust (dämpad vid "No penalty"). */
export function StakeBlocks({ stake, winLabel, loseLabel, ruled = false }: StakeBlocksProps) {
  return (
    <dl className={ruled ? 'rq-duels-stakes rq-duels-stakes--ruled' : 'rq-duels-stakes'}>
      <div data-tone="up">
        <dt>{winLabel}</dt>
        <dd>{keepDurationTogether(stake.win)}</dd>
      </div>
      <div data-tone={stake.loseTone}>
        <dt>{loseLabel}</dt>
        <dd>{keepDurationTogether(stake.lose)}</dd>
      </div>
    </dl>
  );
}
