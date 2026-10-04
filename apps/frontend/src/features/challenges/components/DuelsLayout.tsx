import type { ReactNode } from 'react';
import type { ChallengeTier } from '@runquest/types';
import { RQIcon } from '@/shared/components/icons';
import { ViewTabs, type ViewTab } from '@/shared/components/ViewTabs';
import { panelId, tabId } from '@/shared/components/viewTabIds';
import type { BoostView, DuelsView, IncomingCard, LiveCard, RecordCell, SentCard, StandingRow, TierGroup } from '../duelsModel';
import type { TierRule } from '../rulesModel';
import type { SendBlocker } from '../sendModel';
import '../duels.css';
import { HistoryList, type HistoryListProps } from './HistoryList';
import { IncomingOffer, SentOffer } from './OfferCards';
import { LiveSection } from './LiveSection';
import { RulesView } from './RulesView';
import { BoostPanel, RecordPanel, TokensPanel } from './SidePanels';
import { StandingsTable } from './StandingsTable';

const ID_PREFIX = 'duels';
const ICON_SEND = 17;

const TABS: readonly ViewTab<DuelsView>[] = [
  { key: 'standings', label: 'Standings', icon: 'trophy' },
  { key: 'live', label: 'Live', icon: 'swords' },
  { key: 'rules', label: 'Rules', icon: 'book' },
  { key: 'history', label: 'History', icon: 'clock' },
];

/** Besked efter en handling (Toaster är inte monterad i appen, så resultatet står på sidan). */
export interface Notice {
  tone: 'ok' | 'error';
  text: string;
}

type HistoryProps = Omit<HistoryListProps, 'showReward' | 'onOpenRunner'>;

export interface DuelsLayoutProps {
  isDesktop: boolean;
  view: DuelsView;
  onViewChange: (view: DuelsView) => void;
  summary: string;
  notice: Notice | null;
  /** Varför jag inte kan skicka — styr om Send är guldknappen (bara när det går att skicka). */
  blocker: SendBlocker | null;
  inLiveDuel: boolean;
  onOpenSend: (tier?: ChallengeTier) => void;
  live: LiveCard[];
  incoming: IncomingCard[];
  sent: SentCard | null;
  standings: StandingRow[];
  history: HistoryProps;
  rules: TierRule[];
  tokens: TierGroup[];
  boosts: BoostView[];
  record: RecordCell[];
  /** Id på den utmaning som just besvaras/dras tillbaka (låser dess knappar). */
  busyId: string | null;
  onAccept: (challengeId: string) => void;
  onDecline: (challengeId: string) => void;
  onWithdraw: (challengeId: string) => void;
  onOpenRunner: (userId: string) => void;
}

/**
 * Duels-skärmens presentation: rubrik + Send, flikar (Standings · Live · Rules · History), den aktiva vyn och sidokolumnen
 * (mobil: under vyn; desktop: 320 px till höger). Ren presentation av färdiga vymodeller — datahämtning och handlingar
 * ligger i DuelsScreen, och landningens preview matar samma layout med exempeldata.
 */
export function DuelsLayout(props: DuelsLayoutProps) {
  const { isDesktop, view, blocker, incoming, sent } = props;

  const tabs = (
    <div data-tour="duels-tabs">
      <ViewTabs label="Duels view" tabs={TABS} value={view} onChange={props.onViewChange} idPrefix={ID_PREFIX} className="rq-duels__tabs" />
    </div>
  );

  const sendButton = (
    <button
      type="button"
      data-tour="duels-send"
      className={`rq-btn ${blocker ? 'rq-btn--secondary' : 'rq-btn--primary'} rq-duels__send`}
      onClick={() => props.onOpenSend()}
    >
      {isDesktop && <RQIcon name="swords" size={ICON_SEND} />}
      {isDesktop ? 'Send a challenge' : 'Send'}
    </button>
  );

  const offers = incoming.length > 0 || sent !== null;
  const live = (
    <div className="rq-duels__stack">
      {offers && (
        <ul className="rq-duels-offers" aria-label="Challenges waiting">
          {incoming.map((card, index) => (
            <IncomingOffer
              key={card.id}
              card={card}
              primary={index === 0 && !props.inLiveDuel}
              busy={props.busyId === card.id}
              acceptBlocked={props.inLiveDuel}
              onAccept={() => props.onAccept(card.id)}
              onDecline={() => props.onDecline(card.id)}
              onOpenRunner={props.onOpenRunner}
            />
          ))}
          {sent && <SentOffer card={sent} busy={props.busyId === sent.id} onWithdraw={() => props.onWithdraw(sent.id)} onOpenRunner={props.onOpenRunner} />}
        </ul>
      )}
      <LiveSection cards={props.live} onOpenRunner={props.onOpenRunner} />
    </div>
  );

  const panels: Record<DuelsView, ReactNode> = {
    live,
    standings: <StandingsTable rows={props.standings} showTitle={isDesktop} onOpenRunner={props.onOpenRunner} />,
    rules: <RulesView tiers={props.rules} />,
    history: <HistoryList {...props.history} showReward={isDesktop} onOpenRunner={props.onOpenRunner} />,
  };

  const side = (
    <div className="rq-duels__side">
      <TokensPanel groups={props.tokens} blocker={blocker} showIntro={isDesktop} onSend={props.onOpenSend} />
      <BoostPanel boosts={props.boosts} />
      {isDesktop && <RecordPanel cells={props.record} />}
    </div>
  );

  return (
    <div className="rq-duels">
      <header className="rq-duels__head">
        <div>
          <h1 className="rq-display rq-duels__title">Challenges</h1>
          <p className="rq-duels__sub">{props.summary}</p>
        </div>
        {isDesktop ? (
          <div className="rq-duels__controls">
            {tabs}
            {sendButton}
          </div>
        ) : (
          sendButton
        )}
      </header>
      {!isDesktop && tabs}

      {props.notice && (
        <p role={props.notice.tone === 'error' ? 'alert' : 'status'} className="rq-duels-notice" data-tone={props.notice.tone}>
          {props.notice.text}
        </p>
      )}

      <div className={isDesktop ? 'rq-duels__split' : 'rq-duels__stack'}>
        <div key={view} role="tabpanel" id={panelId(ID_PREFIX)} aria-labelledby={tabId(ID_PREFIX, view)} className="rq-duels__panel rq-rise">
          {panels[view]}
        </div>
        {side}
      </div>
    </div>
  );
}
