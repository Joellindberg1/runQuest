import type { Stake } from '../duelsFormat';

interface StakeBlocksProps {
  stake: Stake;
  winLabel: string;
  loseLabel: string;
  /** Hårlinje ovanför (live-kortets Win/Lose-fot). */
  ruled?: boolean;
}

/** Vinst och förlust som två celler: grön vinst, röd förlust (dämpad vid "No penalty"). */
export function StakeBlocks({ stake, winLabel, loseLabel, ruled = false }: StakeBlocksProps) {
  return (
    <dl className={ruled ? 'rq-duels-stakes rq-duels-stakes--ruled' : 'rq-duels-stakes'}>
      <div data-tone="up">
        <dt>{winLabel}</dt>
        <dd>{stake.win}</dd>
      </div>
      <div data-tone={stake.loseTone}>
        <dt>{loseLabel}</dt>
        <dd>{stake.lose}</dd>
      </div>
    </dl>
  );
}
