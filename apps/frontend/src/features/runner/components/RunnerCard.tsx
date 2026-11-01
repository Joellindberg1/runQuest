import { useEffect, useRef, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import type { User } from '@runquest/types';
import { paths } from '@/paths';
import { useViewParam } from '@/shared/hooks/useViewParam';
import { useHeadToHead } from '../hooks/useRunnerQueries';
import { DEFAULT_STAT_VIEW, STAT_VIEWS } from '../statViews';
import { ChallengeButton } from './ChallengeButton';
import { RunnerPanels } from './RunnerPanels';
import '../runner.css';

interface RunnerCardProps {
  user: User;
  allUsers: User[];
  /** Ett steg bakåt (`useCloseRunner`): tillbakalänkens vanliga klick. */
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

  // Skalet flyttar inte fokus vid sidbyte, så kortet gör det: till sidans enda h1 (hjältekortets namn, tabIndex -1), både vid direktladdning och när kortet nås inifrån appen.
  // Utan `preventScroll`: sidbyte återställer inte alltid scrollen (en scrollad Board eller Log på en telefon), och rubriken ska synas i bild.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rootRef.current?.querySelector('h1')?.focus();
  }, []);

  // Länkens vanliga klick är ett steg bakåt, inte en navigering till /board. Ctrl/Cmd/Shift/Alt-klick och mittenknappen lämnas åt webbläsaren (öppna /board i en ny flik eller ett nytt fönster).
  const handleBack = (event: MouseEvent<HTMLAnchorElement>) => {
    const plainLeftClick = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    if (!plainLeftClick) return;
    event.preventDefault();
    onBack();
  };

  return (
    <div ref={rootRef} className="rq-runner rq-rise">
      <div className="rq-runner__bar">
        <Link to={paths.board} className="rq-back" onClick={handleBack}>
          <span aria-hidden="true">←</span>{' '}
          <span>Standings</span>
        </Link>
        <span className="rq-runner__spacer" />
        <ChallengeButton opponentId={user.id} active={headToHead.data?.active?.status ?? null} />
      </div>

      <div className="rq-runner__body">
        <RunnerPanels user={user} allUsers={allUsers} statView={statView} onStatViewChange={setStatView} />
      </div>
    </div>
  );
}
