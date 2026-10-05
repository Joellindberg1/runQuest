import { HOW_IT_WORKS } from '../rulesModel';
import type { TierRule } from '../rulesModel';
import { StakeBlocks } from './StakeBlocks';
import { TierRibbon } from './TierRibbon';

interface RulesViewProps {
  tiers: TierRule[];
}

/** Rules: ett kort per nivå (insatsen ur verkliga data) och reglerna som inte syns på korten. */
export function RulesView({ tiers }: RulesViewProps) {
  return (
    <div className="rq-duels-rules">
      <ul className="rq-duels-rules__tiers" aria-label="Challenge tiers">
        {tiers.map((rule) => (
          <li key={rule.tier} className="rq-card rq-card--edge rq-duels-rule" data-tier={rule.tier}>
            <div className="rq-duels-rule__head">
              <TierRibbon tier={rule.tier} />
              <h2 className="rq-duels-rule__title">{rule.label}</h2>
            </div>
            <p className="rq-duels-rule__body">{rule.body}</p>
            <StakeBlocks stake={rule.stake} winLabel="Win" loseLabel="Lose" ruled />
          </li>
        ))}
      </ul>
      <section className="rq-card rq-duels-how" aria-labelledby="duels-how-heading">
        <h2 id="duels-how-heading" className="rq-title">How it works</h2>
        <ul className="rq-hairgrid rq-duels-how__list">
          {HOW_IT_WORKS.map((item) => (
            <li key={item.title} className="rq-cell rq-duels-how__item">
              <h3 className="rq-duels-how__name">{item.title}</h3>
              <p className="rq-duels-how__body">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
