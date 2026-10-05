import type { ChallengeTier } from '@runquest/types';
import type { BoostView, RecordCell, TierGroup } from '../duelsModel';
import type { SendBlocker } from '../sendModel';
import { TierRibbon } from './TierRibbon';

interface TokensPanelProps {
  groups: TierGroup[];
  blocker: SendBlocker | null;
  /** Desktop: förklaringsraden under rubriken. */
  showIntro: boolean;
  onSend: (tier: ChallengeTier) => void;
}

/**
 * "Your tokens": osända tokens per nivå (sköld med antal, insats, Send). Send på en nivå öppnar send-sheeten med nivån
 * förvald. Går det inte att skicka just nu är knapparna låsta och orsaken står under listan.
 */
export function TokensPanel({ groups, blocker, showIntro, onSend }: TokensPanelProps) {
  return (
    <section className="rq-card rq-duels-tokens" data-tour="duels-tokens" aria-labelledby="duels-tokens-heading">
      <h2 id="duels-tokens-heading" className="rq-title">Your tokens</h2>
      {showIntro && <p className="rq-duels-tokens__intro">One token, one challenge. A token fixes the metric and the length; you pick who gets it.</p>}
      {groups.length === 0 ? (
        <p className="rq-duels-note">No tokens to send. You earn them by levelling up.</p>
      ) : (
        <ul className="rq-duels-tokens__list">
          {groups.map((group) => (
            <li key={group.tier} className="rq-duels-token" data-tier={group.tier}>
              <TierRibbon tier={group.tier} count={group.count} />
              <div className="rq-duels-token__text">
                <span className="rq-duels-token__tier">{group.label}</span>
                <span className="rq-duels-token__stake">{group.stake.summary}</span>
              </div>
              <button
                type="button"
                className="rq-duels-token__send"
                disabled={blocker !== null}
                aria-label={`Send a ${group.label.toLowerCase()} challenge`}
                onClick={() => onSend(group.tier)}
              >
                Send
              </button>
            </li>
          ))}
        </ul>
      )}
      {blocker && groups.length > 0 && <p className="rq-duels-tokens__why">{blocker.message}</p>}
    </section>
  );
}

/** Aktiva boosts/straff: grön vänsterkant för en boost, röd för ett straff. */
export function BoostPanel({ boosts }: { boosts: BoostView[] }) {
  if (boosts.length === 0) return null;
  return (
    <ul className="rq-duels-boosts" aria-label="Active boosts">
      {boosts.map((boost) => (
        <li key={boost.id} className="rq-card rq-card--edge rq-duels-boost" data-tone={boost.positive ? 'up' : 'down'}>
          <p className="rq-duels-boost__eyebrow">{boost.positive ? 'Boost active' : 'Penalty active'}</p>
          <p className="rq-duels-boost__headline">{boost.headline}</p>
          {boost.detail && <p className="rq-duels-boost__detail">{boost.detail}</p>}
        </li>
      ))}
    </ul>
  );
}

/** "Your record": vunna · oavgjorda · förlorade · vinstprocent (desktop-sidokolumnen). */
export function RecordPanel({ cells }: { cells: RecordCell[] }) {
  return (
    <section className="rq-card rq-duels-record" aria-labelledby="duels-record-heading">
      <h2 id="duels-record-heading" className="rq-label rq-duels-record__title">Your record</h2>
      <dl className="rq-hairgrid rq-duels-record__cells">
        {cells.map((cell) => (
          <div key={cell.key} className="rq-cell rq-duels-record__cell" data-cell={cell.key}>
            <dt className="rq-duels-record__label">{cell.label}</dt>
            <dd className="rq-duels-record__value" data-tone={cell.tone}>{cell.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
