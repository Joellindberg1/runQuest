import { useState } from 'react';
import type { User } from '@runquest/types';
import { useRunnerCardData } from '../hooks/useRunnerCardData';
import { DEFAULT_STAT_VIEW, type StatView } from '../statViews';
import { RunnerPanels } from './RunnerPanels';
import '../runner.css';

interface RunnerPopupProps {
  user: User;
  allUsers: User[];
}

/**
 * Innehållet i profil-popupen (ADR 006 addendum 2026-10-26): löparens kort i dialogens scrollande yta. Dialogramen (Radix Dialog, rubriken "Runner card",
 * Challenge, ✕, fokus in och tillbaka) ligger i `pages/RunnerPage.tsx`; den här komponenten laddas lazy (`React.lazy`) så att den aldrig hamnar i
 * ingångs-chunken. Tills flikarna (Overview, The journey, Titles held, Badges) är byggda ritar den Runner cards befintliga paneler.
 *
 * Tillståndet är komponenttillstånd, inte adress (beslut 3): statfliken nollställs vid varje öppning eftersom värden monterar komponenten med `key={user.id}`
 * och popupen avmonteras när den stängs. Popupen skriver aldrig `?view=`.
 */
export function RunnerPopup({ user, allUsers }: RunnerPopupProps) {
  const data = useRunnerCardData(user, allUsers);
  const [statView, setStatView] = useState<StatView>(DEFAULT_STAT_VIEW);

  return (
    <div className="rq-runner rq-rise">
      <div className="rq-runner__body">
        <RunnerPanels user={user} data={data} statView={statView} onStatViewChange={setStatView} />
      </div>
    </div>
  );
}
