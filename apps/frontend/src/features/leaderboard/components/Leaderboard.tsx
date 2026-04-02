import React from 'react';
import { Card, CardContent, CardHeader } from '@/shared/components/ui/card';
import { leaderboardUtils, getInitials } from '@/shared/utils/leaderboardUtils';
import { UserStats } from './leaderboard/UserStats';
import { UserCardHeader } from './leaderboard/UserCardHeader';
import { LevelProgress } from './leaderboard/LevelProgress';
import { useMultipleUserTitles } from '@/shared/hooks/useTitleQueries';
import { useUserProfileModal } from '@/providers/UserProfileModalProvider';
import { Swords } from 'lucide-react';
import type { User, UserTitle } from '@runquest/types';

const PODIUM_ACCENT: Record<number, string> = {
  1: 'var(--rq-rank-1)',
  2: 'var(--rq-rank-2)',
  3: 'var(--rq-rank-3)',
};

interface LeaderboardProps {
  users: User[];
  currentUser: User;
  titleOverrides?: Record<string, UserTitle[]>;
}

export const Leaderboard: React.FC<LeaderboardProps> = ({ users, currentUser, titleOverrides }) => {
  const { openProfile } = useUserProfileModal();
  const { data: fetchedTitles = {} } = useMultipleUserTitles(users.map((u) => u.id));
  const userTitlesData = titleOverrides
    ? { ...fetchedTitles, ...titleOverrides }
    : fetchedTitles;
  const sortedUsers = leaderboardUtils.filterAndSortUsers(users);

  if (sortedUsers.length === 0) {
    return (
      <div className="space-y-6">
        <div className="text-center py-12">
          <div className="text-2xl text-muted-foreground mb-2">No users found</div>
          <div className="text-muted-foreground/70">Start logging runs to appear on the leaderboard!</div>
        </div>
      </div>
    );
  }

  const getPositionStyles = (position: number) => {
    const accent = PODIUM_ACCENT[position];
    if (accent) return `border border-border` ;
    return 'border border-border bg-card';
  };

  const getPodiumStyle = (position: number): React.CSSProperties => {
    if (position === 1) return {
      background: 'radial-gradient(ellipse at bottom right, var(--rq-rank-1-subtle) 0%, transparent 65%), hsl(var(--card))',
      borderLeft: '2px solid var(--rq-rank-1)',
      animation: 'goldPulse 7s ease-in-out infinite',
    };
    if (position === 2) return {
      background: 'radial-gradient(ellipse at bottom right, var(--rq-rank-2-subtle) 0%, transparent 65%), hsl(var(--card))',
      borderLeft: '2px solid var(--rq-rank-2)',
    };
    if (position === 3) return {
      background: 'radial-gradient(ellipse at bottom right, var(--rq-rank-3-subtle) 0%, transparent 65%), hsl(var(--card))',
      borderLeft: '2px solid var(--rq-rank-3)',
    };
    return {};
  };

  const renderCard = (user: User, tourAnchor?: string) => {
    const isCurrentUser = user.id === currentUser.id;
    const stats = leaderboardUtils.calculateUserStats(user);
    const position = leaderboardUtils.getUserPosition(user, sortedUsers);
    const isPodium = position <= 3;
    const accent = PODIUM_ACCENT[position];
    const heldTitles = (userTitlesData[user.id] || []).filter((t) => t.is_current_holder);
    const displayIds = user.displayed_title_ids ?? [];
    const orderedTitles: UserTitle[] = (displayIds.length > 0
      ? displayIds.map(id => heldTitles.find(t => t.title_id === id)).filter(Boolean) as UserTitle[]
      : heldTitles).slice(0, 3);
    const titles: UserTitle[] =
      position === 1 && orderedTitles.length === 0
        ? [{ title_id: 'default', title_name: 'Eliud Kipchoge', value: 0, is_current_holder: true }]
        : orderedTitles;
    const initials = getInitials(user.name);
    const counts = user.challenge_counts ?? {};
    const TIERS = ['minor', 'major', 'legendary'] as const;
    const FLAG_STYLES: Record<string, { style: React.CSSProperties; height: number }> = {
      minor: {
        height: 26,
        style: {
          background: 'linear-gradient(to bottom, #60a5fa 0%, #1d4ed8 100%)',
          color: '#fff',
          filter: 'drop-shadow(0 2px 4px rgba(37,99,235,0.55))',
        },
      },
      major: {
        height: 30,
        style: {
          background: 'linear-gradient(to bottom, #fb923c 0%, #c2410c 100%)',
          color: '#fff',
          filter: 'drop-shadow(0 2px 5px rgba(234,88,12,0.6))',
        },
      },
      legendary: {
        height: 36,
        style: {
          background: `linear-gradient(to bottom, var(--rq-gold) 0%, color-mix(in srgb, var(--rq-gold) 55%, #000) 100%)`,
          color: 'var(--rq-gold-fg, #1a1200)',
          animation: 'legendaryFlagGlow 2.5s ease-in-out infinite',
        },
      },
    };

    const cardStyle: React.CSSProperties = isPodium
      ? getPodiumStyle(position)
      : isCurrentUser
        ? { borderLeft: '2px solid var(--rq-gold)', background: 'color-mix(in srgb, var(--rq-gold) 3%, transparent)', height: '100%' }
        : { height: '100%' };

    return (
      <Card
        key={user.id}
        {...(tourAnchor ? { 'data-tour': tourAnchor } : {})}
        className={`relative overflow-visible cursor-pointer hover:brightness-105 transition-[filter] ${getPositionStyles(position)}`}
        style={cardStyle}
        onClick={() => openProfile(user.id)}
      >
        {/* Active user indicator — top of card, inset from left border */}
        {isCurrentUser && (
          <div
            className="absolute top-0 left-5 h-[2px] w-10 animate-pulse z-10"
            style={{ background: 'var(--rq-gold)', boxShadow: '0 0 5px var(--rq-gold)' }}
          />
        )}

        {/* Watermark position number — top-right, intentionally overflows card */}
        <span
          className="absolute select-none pointer-events-none leading-none z-0"
          style={{
            fontFamily: 'Bebas Neue, sans-serif',
            fontSize: '8rem',
            top: '-1.75rem',
            right: '0.25rem',
            color: accent ?? 'var(--rq-watermark)',
            opacity: isPodium ? 0.45 : 0.10,
            lineHeight: 1,
          }}
        >
          {position}
        </span>

        {/* Challenge flags hanging from bottom-right corner */}
        <div className="absolute flex gap-0.5 items-end z-10" style={{ bottom: -20, left: 14 }}>
          {TIERS.map(tier => {
            const count = counts[tier];
            if (!count) return null;
            const { style, height } = FLAG_STYLES[tier];
            return (
              <div
                key={tier}
                className="text-[10px] font-bold w-6 flex items-start justify-center pt-1 leading-none select-none"
                style={{
                  clipPath: 'polygon(0 0, 100% 0, 100% 78%, 50% 100%, 0 78%)',
                  height,
                  ...style,
                }}
              >
                {count}
              </div>
            );
          })}
        </div>

        {/* Active challenge swords icon */}
        {user.challenge_active && (
          <div className="absolute bottom-[9px] right-3 z-10">
            <Swords className="w-[16px] h-[16px] animate-pulse" style={{ color: 'var(--rq-gold)' }} />
          </div>
        )}

        <CardHeader className="pt-3 pb-2 pr-16">
          <UserCardHeader
            user={user}
            position={position}
            level={stats.level}
            initials={initials}
            titles={titles}
            totalHeld={heldTitles.length}
          />
        </CardHeader>

        <CardContent className="p-4 pt-0 pb-8" data-tour="leaderboard-run-history">
          <LevelProgress
            xpProgress={stats.xpProgress}
            xpLeftForNextLevel={stats.xpLeftForNextLevel}
            xpInLevel={stats.xpInLevel}
            xpLevelRange={stats.xpLevelRange}
          />
          <div className="mt-3" />
          <UserStats
            user={user}
            stats={{
              numberOfRuns: stats.numberOfRuns,
              longestRun: stats.longestRun,
              averageKmPerRun: stats.averageKmPerRun,
              avgXpPer14Days: stats.avgXpPer14Days,
              daysToNextLevel: stats.daysToNextLevel,
              latestRun: stats.latestRun,
            }}
          />
        </CardContent>
      </Card>
    );
  };

  const podiumUsers = sortedUsers.slice(0, Math.min(3, sortedUsers.length));
  const restUsers = sortedUsers.slice(podiumUsers.length);

  const podiumSlots =
    podiumUsers.length === 3
      ? [
          { user: podiumUsers[1], mt: 'mt-6',  step: 2 },
          { user: podiumUsers[0], mt: 'mt-0',  step: 1 },
          { user: podiumUsers[2], mt: 'mt-12', step: 3 },
        ]
      : podiumUsers.length === 2
        ? [
            { user: podiumUsers[1], mt: 'mt-8', step: 2 },
            { user: podiumUsers[0], mt: 'mt-0', step: 1 },
          ]
        : [{ user: podiumUsers[0], mt: 'mt-0', step: 1 }];

  const stepHeights: Record<number, string> = { 1: 'h-16', 2: 'h-12', 3: 'h-8' };
  const stepLabels: Record<number, string> = { 1: '1ST', 2: '2ND', 3: '3RD' };

  return (
    <div className="space-y-4" data-tour="leaderboard-table">

      {/* Mobile: simple ordered list */}
      <div className="md:hidden space-y-6">
        {podiumUsers.map((user) => renderCard(user))}
      </div>

      {/* Desktop: stepped podium layout with platform steps */}
      <div className="hidden md:block">
        <div className="flex gap-6 justify-center items-end">
          {podiumSlots.map(({ user, mt, step }) => {
            return (
              <div key={user.id} className="flex flex-col items-center w-[380px]">
                <div className={`${mt} w-full`} style={{ minHeight: '380px', display: 'flex', flexDirection: 'column' }}>
                  {renderCard(user, step === 1 ? 'leaderboard-card' : undefined)}
                </div>
                {/* Podium step platform */}
                <div
                  className={`w-full mt-1 ${stepHeights[step]} flex items-center justify-center`}
                  style={{
                    background: `linear-gradient(to bottom, var(--rq-rank-${step}-subtle), transparent)`,
                    borderTop: `2px solid var(--rq-rank-${step}-border)`,
                  }}
                >
                  <span
                    className="font-bold tracking-widest"
                    style={{ fontFamily: 'Bebas Neue, sans-serif', fontSize: '0.85rem', color: `var(--rq-rank-${step})`, opacity: 0.7 }}
                  >
                    {stepLabels[step]}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Positions 4+: CSS grid — rows automatically match height of tallest card */}
      {restUsers.length > 0 && (
        <div style={{ marginTop: '2rem', display: 'flex', flexWrap: 'wrap', gap: '1.5rem', justifyContent: 'center' }}>
          {restUsers.map((user) => (
            <div key={user.id} style={{ width: '330px', flexShrink: 0 }}>
              {renderCard(user)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
