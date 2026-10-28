import { useMemo } from 'react';
import type { User } from '@runquest/types';
import { useNow } from '@/app-shell/useNow';
import { buildRunnerBadges } from '@/features/badges/badgeModel';
import { BadgePanel } from '@/features/badges/components/BadgePanel';
import { useGroupBadges, useUserBadges } from '@/features/badges/hooks/useBadgeQueries';
import { useAuth } from '@/providers/authContext';
import { useHeadToHead, useRunnerTitles } from '../hooks/useRunnerQueries';
import { buildHero, buildStatCells } from '../runnerModel';
import type { StatView } from '../statViews';
import { HeadToHeadPanel } from './HeadToHeadPanel';
import { HeroCard } from './HeroCard';
import { JourneyCard } from './JourneyCard';
import { StatsPanel } from './StatsPanel';
import { TitlesPanel } from './TitlesPanel';

interface RunnerPanelsProps {
  user: User;
  allUsers: User[];
  /** Vald statflik. Värden äger den: sidan i adressen (`?view=`), popupen som komponenttillstånd. */
  statView: StatView;
  onStatViewChange: (view: StatView) => void;
}

/**
 * Runner cards paneler och all deras datakoppling, i EN DOM-ordning för alla bredder: hero · journey · (statflikar | titlar) · (badges | head to head). Placeringen i
 * kolumner avgörs av `--rq-runner-split-cols` (CSS), inte av JS. Sidan (`RunnerCard`) och popupen (`RunnerPopup`) ritar samma paneler över samma data; bara ramen skiljer.
 *
 * Löparens badges (spec F11): minis i hjältekortet och den kompakta, skrivskyddade BADGES-panelen. Badges är tillägg, inte kortets kärna: medan de laddas visar panelen
 * laddaren, och felar de ritas inga minis och panelen visar ett felkort med Retry (tomläget gäller bara ett lyckat, tomt svar). Gruppens holders ger held-by; felar den
 * utelämnas raden utan platshållare.
 */
export function RunnerPanels({ user, allUsers, statView, onStatViewChange }: RunnerPanelsProps) {
  const { user: me } = useAuth();
  const now = useNow();
  const titlesQuery = useRunnerTitles(user.id);
  const headToHead = useHeadToHead(user.id);
  const userBadges = useUserBadges(user.id);
  const groupBadges = useGroupBadges(!!me);

  const hero = useMemo(() => buildHero(user, allUsers), [user, allUsers]);
  const heldTitles = titlesQuery.data ? titlesQuery.data.filter((title) => title.is_current_holder).length : null;
  const cells = useMemo(() => buildStatCells(user, heldTitles), [user, heldTitles]);
  const badges = useMemo(
    () => buildRunnerBadges(userBadges.data, groupBadges.data, { viewerId: me?.id ?? null, ownerId: user.id }),
    [userBadges.data, groupBadges.data, me?.id, user.id],
  );
  // Felkort med Retry bara när det inte finns något att visa: en misslyckad bakgrundsomhämtning låter den gamla samlingen stå kvar.
  const badgeError = userBadges.isError && !userBadges.data
    ? { retrying: userBadges.isFetching, onRetry: () => void userBadges.refetch() }
    : undefined;

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
        <BadgePanel rows={badges.rows} loading={userBadges.isLoading} error={badgeError} />
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
