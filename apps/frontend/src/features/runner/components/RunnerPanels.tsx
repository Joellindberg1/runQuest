import type { User } from '@runquest/types';
import { BadgePanel } from '@/features/badges/components/BadgePanel';
import type { RunnerCardData } from '../hooks/useRunnerCardData';
import type { StatView } from '../statViews';
import { HeadToHeadPanel } from './HeadToHeadPanel';
import { HeroCard } from './HeroCard';
import { JourneyCard } from './JourneyCard';
import { StatsPanel } from './StatsPanel';
import { TitlesPanel } from './TitlesPanel';

interface RunnerPanelsProps {
  user: User;
  data: RunnerCardData;
  /** Vald statflik. Värden äger den: sidan i adressen (`?view=`), popupen som komponenttillstånd. */
  statView: StatView;
  onStatViewChange: (view: StatView) => void;
}

/**
 * Runner cards paneler i EN DOM-ordning för alla bredder: hero · journey · (statflikar | titlar) · (badges | head to head). Placeringen i kolumner avgörs av
 * `--rq-runner-split-cols` (CSS), inte av JS. Sidan (`RunnerCard`) och popupen (`RunnerPopup`) ritar samma paneler över samma data.
 */
export function RunnerPanels({ user, data, statView, onStatViewChange }: RunnerPanelsProps) {
  const { me, now, headToHead, hero, cells, badges, badgeLoading, badgeError } = data;

  return (
    <>
      <HeroCard hero={hero} cells={cells} showcase={badges.showcase} />
      <JourneyCard totalKm={user.total_km} />
      <div className="rq-runner__split">
        <StatsPanel user={user} now={now} view={statView} onChange={onStatViewChange} />
        <div className="rq-runner__side">
          <TitlesPanel user={user} />
        </div>
      </div>
      <div className="rq-runner__lower">
        <BadgePanel rows={badges.rows} loading={badgeLoading} error={badgeError} />
        {me && (
          <HeadToHeadPanel
            opponentName={user.name}
            meId={me.id}
            data={headToHead.data}
            isError={headToHead.isError}
            isFetching={headToHead.isFetching}
            onRetry={() => void headToHead.refetch()}
          />
        )}
      </div>
    </>
  );
}
