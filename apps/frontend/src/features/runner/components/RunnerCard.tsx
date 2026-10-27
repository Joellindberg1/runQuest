import { useMemo } from 'react';
import type { User } from '@runquest/types';
import { useNow } from '@/app-shell/useNow';
import { buildRunnerBadges } from '@/features/badges/badgeModel';
import { BadgePanel } from '@/features/badges/components/BadgePanel';
import { useGroupBadges, useUserBadges } from '@/features/badges/hooks/useBadgeQueries';
import { useAuth } from '@/providers/authContext';
import { useViewParam } from '@/shared/hooks/useViewParam';
import { useHeadToHead, useRunnerTitles } from '../hooks/useRunnerQueries';
import { buildHero, buildStatCells } from '../runnerModel';
import { DEFAULT_STAT_VIEW, STAT_VIEWS } from '../statViews';
import { ChallengeButton } from './ChallengeButton';
import { HeadToHeadPanel } from './HeadToHeadPanel';
import { HeroCard } from './HeroCard';
import { JourneyCard } from './JourneyCard';
import { StatsPanel } from './StatsPanel';
import { TitlesPanel } from './TitlesPanel';
import '../runner.css';

interface RunnerCardProps {
  user: User;
  allUsers: User[];
  /** `page`: egen sida i skalet (mobil, direktladdning) — Back-knappen. `overlay`: desktop-modalen — "Runner profile". */
  variant: 'page' | 'overlay';
  /** Bara för `page`. */
  onBack?: () => void;
}

/**
 * Runner card (ADR 006 beslut 6): hjältekort · Frodo's journey · statflikar · titlar · head-to-head och den
 * ENDA guldknappen, Challenge. Datahämtningen delas av båda varianterna; bara ramen skiljer.
 *
 * Löparens badges (spec F11): minis i hjältekortet och den kompakta, skrivskyddade BADGES-panelen (44 px-emblem med detaljpopover). Panelen har EN plats i
 * DOM-ordningen för alla bredder — `.rq-runner__lower` under statflikar | titlar, bredvid Head to head på desktop och efter TITLES (före Head to head) på mobil;
 * staplingen avgörs av `--rq-runner-split-cols`, inte av JS. Badges är tillägg: medan de laddas visar panelen
 * laddaren, och felar de ritas inga minis och panelen visar ett felkort med Retry (tomläget gäller bara ett lyckat, tomt svar; 404 kan inte nås
 * eftersom kortet bara öppnas för gruppmedlemmar) — resten av kortet och Challenge berörs inte.
 */
export function RunnerCard({ user, allUsers, variant, onBack }: RunnerCardProps) {
  const { user: me } = useAuth();
  const now = useNow();
  const titlesQuery = useRunnerTitles(user.id);
  const headToHead = useHeadToHead(user.id);
  const userBadges = useUserBadges(user.id);
  const groupBadges = useGroupBadges(!!me);
  // Statflikarna ligger över `?view=` (ADR 006 beslut 3): adressen bor här, panelen är kontrollerad.
  const [statView, setStatView] = useViewParam(STAT_VIEWS, DEFAULT_STAT_VIEW);

  const hero = useMemo(() => buildHero(user, allUsers), [user, allUsers]);
  const heldTitles = titlesQuery.data ? titlesQuery.data.filter((title) => title.is_current_holder).length : null;
  const cells = useMemo(() => buildStatCells(user, heldTitles), [user, heldTitles]);
  // Gruppens holders ger held-by; felar den utelämnas raden (data är då undefined) utan platshållare.
  const badges = useMemo(
    () => buildRunnerBadges(userBadges.data, groupBadges.data, { viewerId: me?.id ?? null, ownerId: user.id }),
    [userBadges.data, groupBadges.data, me?.id, user.id],
  );
  // Felkort med Retry bara när det inte finns något att visa: en misslyckad bakgrundsomhämtning låter den gamla samlingen stå kvar.
  const badgeError = userBadges.isError && !userBadges.data
    ? { retrying: userBadges.isFetching, onRetry: () => void userBadges.refetch() }
    : undefined;
  const badgePanel = <BadgePanel rows={badges.rows} loading={userBadges.isLoading} error={badgeError} />;

  return (
    <div className="rq-runner rq-rise" data-variant={variant}>
      <div className="rq-runner__bar">
        {variant === 'page' ? (
          <button type="button" className="rq-back" onClick={onBack}>
            <span aria-hidden="true">‹</span>
            <span>Back</span>
          </button>
        ) : (
          <span className="rq-runner__eyebrow">Runner profile</span>
        )}
        <span className="rq-runner__spacer" />
        <ChallengeButton opponentId={user.id} active={headToHead.data?.active?.status ?? null} />
      </div>

      <div className="rq-runner__body">
        <HeroCard hero={hero} cells={cells} showcase={badges.showcase} />
        <JourneyCard totalKm={user.total_km} />
        <div className="rq-runner__split">
          <StatsPanel user={user} now={now} view={statView} onChange={setStatView} />
          <div className="rq-runner__side">
            <TitlesPanel user={user} />
          </div>
        </div>
        <div className="rq-runner__lower">
          {badgePanel}
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
      </div>
    </div>
  );
}
