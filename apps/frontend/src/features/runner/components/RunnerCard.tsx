import type { User } from '@runquest/types';
import { useViewParam } from '@/shared/hooks/useViewParam';
import { useRunnerCardData } from '../hooks/useRunnerCardData';
import { DEFAULT_STAT_VIEW, STAT_VIEWS } from '../statViews';
import { ChallengeButton } from './ChallengeButton';
import { RunnerPanels } from './RunnerPanels';
import '../runner.css';

interface RunnerCardProps {
  user: User;
  allUsers: User[];
  /** Back-knappen i toppraden. */
  onBack: () => void;
}

/**
 * Runner card som sida i skalet (ADR 006 beslut 6): mobil och direktladdning av `/runner/:id`. Hjältekort · Frodo's journey · statflikar · titlar ·
 * head-to-head och den ENDA guldknappen, Challenge. På desktop inifrån appen visas löparen i stället som profil-popupen (`RunnerPopup`); datahämtningen
 * (`useRunnerCardData`) och panelerna (`RunnerPanels`) delas, bara ramen skiljer.
 *
 * Löparens badges (spec F11): minis i hjältekortet och den kompakta, skrivskyddade BADGES-panelen (44 px-emblem med detaljpopover). Panelen har EN plats i
 * DOM-ordningen för alla bredder — `.rq-runner__lower` under statflikar | titlar, bredvid Head to head på desktop och efter TITLES (före Head to head) på mobil;
 * staplingen avgörs av `--rq-runner-split-cols`, inte av JS. Badges är tillägg: medan de laddas visar panelen laddaren, och felar de ritas inga minis och
 * panelen visar ett felkort med Retry — resten av kortet och Challenge berörs inte.
 */
export function RunnerCard({ user, allUsers, onBack }: RunnerCardProps) {
  const data = useRunnerCardData(user, allUsers);
  // Statflikarna ligger över `?view=` (ADR 006 beslut 3): adressen bor här, panelen är kontrollerad.
  const [statView, setStatView] = useViewParam(STAT_VIEWS, DEFAULT_STAT_VIEW);

  return (
    <div className="rq-runner rq-rise">
      <div className="rq-runner__bar">
        <button type="button" className="rq-back" onClick={onBack}>
          <span aria-hidden="true">‹</span>
          <span>Back</span>
        </button>
        <span className="rq-runner__spacer" />
        <ChallengeButton opponentId={user.id} active={data.headToHead.data?.active?.status ?? null} />
      </div>

      <div className="rq-runner__body">
        <RunnerPanels user={user} data={data} statView={statView} onStatViewChange={setStatView} />
      </div>
    </div>
  );
}
