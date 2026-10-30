import type { User } from '@runquest/types';
import { useViewParam } from '@/shared/hooks/useViewParam';
import { useHeadToHead } from '../hooks/useRunnerQueries';
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
 * head-to-head och den ENDA guldknappen, Challenge. På desktop inifrån appen visas löparen i stället som profil-popupen (`RunnerPopup`); panelerna och
 * datahämtningen delas (`RunnerPanels`), bara ramen skiljer. Head-to-head läses här också (för Challenge-knappens status); samma fråga som panelens delas i cachen.
 */
export function RunnerCard({ user, allUsers, onBack }: RunnerCardProps) {
  const headToHead = useHeadToHead(user.id);
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
        <ChallengeButton opponentId={user.id} active={headToHead.data?.active?.status ?? null} />
      </div>

      <div className="rq-runner__body">
        <RunnerPanels user={user} allUsers={allUsers} statView={statView} onStatViewChange={setStatView} />
      </div>
    </div>
  );
}
