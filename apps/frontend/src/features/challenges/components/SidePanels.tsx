import { useState } from 'react';
import type { ChallengeTier } from '@runquest/shared';
import type { BoostView, RecordCell, TierGroup } from '../duelsModel';
import type { SendBlocker, SendPreselection } from '../sendModel';
import { TierChip } from './TierChip';
import { TierRibbon } from './TierRibbon';

interface TokensPanelProps {
  groups: TierGroup[];
  blocker: SendBlocker | null;
  onSend: (preselection: SendPreselection) => void;
}

/**
 * "Your tokens": alltid tre nivåchips (antal per nivå) och under dem ett kort per token på den valda nivån (mått, längd och tokenets egen
 * insats, Send). Start: första nivån som har tokens. En tom nivå är dämpad och går att fokusera; aktiveras den står orsaken i statusregionen
 * och valet ändras inte. Send på ett kort öppnar send-flödet med nivån och kortet förvalda. Går det inte att skicka just nu är knapparna
 * låsta och orsaken står under listan.
 */
export function TokensPanel({ groups, blocker, onSend }: TokensPanelProps) {
  const [picked, setPicked] = useState<ChallengeTier | null>(null);
  const [explained, setExplained] = useState<TierGroup | null>(null);

  // Valet gäller bara så länge nivån har tokens kvar (efter en skickad utmaning kan den ha tömts).
  const shown = groups.find((group) => group.tier === picked && group.selectable) ?? groups.find((group) => group.selectable) ?? null;

  const press = (group: TierGroup) => {
    if (group.selectable) {
      setPicked(group.tier);
      setExplained(null);
    } else {
      setExplained(group);
    }
  };

  return (
    <section className="rq-card rq-duels-tokens" data-tour="duels-tokens" aria-labelledby="duels-tokens-heading">
      <h2 id="duels-tokens-heading" className="rq-title">Your tokens</h2>
      <div role="group" aria-label="Token tier" className="rq-segmented rq-duels-chips">
        {groups.map((group) => (
          <TierChip key={group.tier} tier={group.tier} label={group.label} count={group.count} selected={group.tier === shown?.tier} onPress={() => press(group)} />
        ))}
      </div>
      {/* Live-regionen måste finnas innan texten kommer för att annonseras: behållaren är permanent, bara texten monteras. */}
      <div role="status" className="rq-duels-tokens__status">
        {explained && <p className="rq-duels-note">No {explained.label} tokens right now</p>}
      </div>
      {shown === null ? (
        <p className="rq-duels-note">No tokens to send. You earn them by levelling up.</p>
      ) : (
        <ul className="rq-duels-tokens__list" aria-label={`${shown.label} tokens`}>
          {shown.cards.map((card) => (
            <li key={card.tokenKey} className="rq-duels-token" data-tier={card.tier}>
              <TierRibbon tier={card.tier} />
              <div className="rq-duels-token__text">
                <span className="rq-duels-token__what">{card.metricLabel} · {card.durationLabel}</span>
                <span className="rq-duels-token__stake"><span>{card.stake.winFor}</span> · <span>{card.stake.loseFor}</span></span>
              </div>
              <button
                type="button"
                className="rq-duels-token__send"
                disabled={blocker !== null}
                aria-label={`Send ${card.metricLabel}, ${card.durationLabel}`}
                onClick={() => onSend({ tier: card.tier, tokenKey: card.tokenKey })}
              >
                Send
              </button>
            </li>
          ))}
        </ul>
      )}
      {blocker && shown !== null && <p className="rq-duels-tokens__why">{blocker.message}</p>}
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
