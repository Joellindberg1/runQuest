import type { User } from '@runquest/types';
import { BadgePanel } from '@/features/badges/components/BadgePanel';
import { useRunnerPanelData } from '../hooks/useRunnerPanelData';
import type { StatView } from '../statViews';
import { HeadToHeadPanel } from './HeadToHeadPanel';
import { HeroCard } from './HeroCard';
import { JourneyCard } from './JourneyCard';
import { StatsPanel } from './StatsPanel';
import { TitlesPanel } from './TitlesPanel';

interface RunnerPanelsProps {
  user: User;
  allUsers: User[];
  /** Vald statflik. Värden äger den: sidan i adressen (`?view=`). */
  statView: StatView;
  onStatViewChange: (view: StatView) => void;
}

/**
 * Runner cards paneler på sidan (`RunnerCard`), i EN DOM-ordning för alla bredder: hero · journey · (statflikar | titlar) · (badges | head to head). Placeringen i
 * kolumner avgörs av `--rq-runner-split-cols` (CSS), inte av JS. Popupen (`RunnerPopup`) ritar samma data (`useRunnerPanelData`) men med bannern och Head to head i en egen panel
 * uppe till höger (`PopupBanner`), och de övriga panelerna en i taget i sina flikar. Head to head-kortet finns bara här, och bara med en inloggad att jämföras med.
 */
export function RunnerPanels({ user, allUsers, statView, onStatViewChange }: RunnerPanelsProps) {
  const data = useRunnerPanelData(user, allUsers);

  return (
    <>
      <HeroCard hero={data.hero} cells={data.cells} showcase={data.showcase} />
      <JourneyCard totalKm={user.total_km} />
      <div className="rq-runner__split">
        <StatsPanel user={user} now={data.now} view={statView} onChange={onStatViewChange} />
        <div className="rq-runner__side">
          <TitlesPanel user={user} />
        </div>
      </div>
      <div className="rq-runner__lower">
        <BadgePanel rows={data.badgeRows} loading={data.badgesLoading} error={data.badgeError} />
        {data.headToHead && <HeadToHeadPanel {...data.headToHead} />}
      </div>
    </>
  );
}
