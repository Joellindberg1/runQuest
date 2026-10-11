import { useMemo } from 'react';
import type { User } from '@runquest/types';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { useNow } from '@/app-shell/useNow';
import { buildRunnerBadges } from '@/features/badges/badgeModel';
import { BadgePanel } from '@/features/badges/components/BadgePanel';
import { useGroupBadges, useUserBadges } from '@/features/badges/hooks/useBadgeQueries';
import { useAuth } from '@/providers/authContext';
import { useHeadToHead, useRunnerTitles } from '../hooks/useRunnerQueries';
import { buildHero, buildStatCells } from '../runnerModel';
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
 * Löparens badges (spec F4): minis i hjältekortet och den skrivskyddade BADGES-panelen. Samma panel överallt, men plats efter bredd:
 * mobil direkt under hjältekortet, desktop i 340 px-sidokolumnen ovanför TITLES (Council 16). Badges är tillägg: medan de laddas visar panelen
 * laddaren, och felar de (404 inkluderat) ritas inga minis och panelen visar tomläget — resten av kortet och Challenge berörs inte.
 */
export function RunnerCard({ user, allUsers, variant, onBack }: RunnerCardProps) {
  const { user: me } = useAuth();
  const now = useNow();
  const wide = useIsDesktop() === true;
  const titlesQuery = useRunnerTitles(user.id);
  const headToHead = useHeadToHead(user.id);
  const userBadges = useUserBadges(user.id);
  const groupBadges = useGroupBadges(!!me);

  const hero = useMemo(() => buildHero(user, allUsers), [user, allUsers]);
  const heldTitles = titlesQuery.data ? titlesQuery.data.filter((title) => title.is_current_holder).length : null;
  const cells = useMemo(() => buildStatCells(user, heldTitles), [user, heldTitles]);
  // Gruppens holders ger held-by; felar den utelämnas raden (data är då undefined) utan platshållare.
  const badges = useMemo(
    () => buildRunnerBadges(userBadges.data, groupBadges.data, { viewerId: me?.id ?? null, ownerId: user.id }),
    [userBadges.data, groupBadges.data, me?.id, user.id],
  );
  const badgePanel = <BadgePanel rows={badges.rows} loading={userBadges.isLoading} />;

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
        {!wide && badgePanel}
        <JourneyCard totalKm={user.total_km} />
        <div className="rq-runner__split">
          <StatsPanel user={user} now={now} />
          <div className="rq-runner__side">
            {wide && badgePanel}
            <TitlesPanel user={user} />
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
    </div>
  );
}
