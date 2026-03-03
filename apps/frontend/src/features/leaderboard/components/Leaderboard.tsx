import React from 'react';
import { Card, CardContent, CardHeader } from '@/shared/components/ui/card';
import { leaderboardUtils, getInitials } from '@/shared/utils/leaderboardUtils';
import { UserStats } from './leaderboard/UserStats';
import { UserCardHeader } from './leaderboard/UserCardHeader';
import { LevelProgress } from './leaderboard/LevelProgress';
import { useMultipleUserTitles } from '@/shared/hooks/useTitleQueries';
import { Swords } from 'lucide-react';
import type { User, UserTitle } from '@/types/run';

interface LeaderboardProps {
  users: User[];
  currentUser: User;
}

export const Leaderboard: React.FC<LeaderboardProps> = ({ users, currentUser }) => {
  const { data: userTitlesData = {} } = useMultipleUserTitles(users.map((u) => u.id));
  const sortedUsers = leaderboardUtils.filterAndSortUsers(users);

  if (sortedUsers.length === 0) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <p className="text-lg font-semibold text-foreground mb-2">🏆 Leaderboard 🏆</p>
        </div>
        <div className="text-center py-12">
          <div className="text-2xl text-muted-foreground mb-2">No users found</div>
          <div className="text-muted-foreground/70">Start logging runs to appear on the leaderboard!</div>
        </div>
      </div>
    );
  }

  const getPositionStyles = (position: number) => {
    if (position === 1) {
      return 'podium-light border-2 !border-podium-gold-border bg-podium-gold shadow-podium-gold/40 shadow-lg';
    } else if (position === 2) {
      return 'podium-light border-2 !border-podium-silver-border bg-podium-silver shadow-podium-silver/40 shadow-lg';
    } else if (position === 3) {
      return 'podium-light border-2 !border-podium-bronze-border bg-podium-bronze shadow-podium-bronze/40 shadow-lg';
    }
    return 'border-2 border-foreground/15 bg-accent text-accent-foreground';
  };

  const renderCard = (user: User) => {
    const isCurrentUser = user.id === currentUser.id;
    const stats = leaderboardUtils.calculateUserStats(user);
    const position = leaderboardUtils.getUserPosition(user, sortedUsers);
    const isPodium = position <= 3;
    const realTitles = (userTitlesData[user.id] || []).filter((t) => t.is_current_holder);
    const titles: UserTitle[] =
      position === 1 && realTitles.length === 0
        ? [{ title_name: 'Eliud Kipchoge', value: 0, is_current_holder: true }]
        : realTitles;
    const initials = getInitials(user.name);
    const counts = user.challenge_counts ?? {};
    const TIERS = ['minor', 'major', 'legendary'] as const;
    const FLAG_COLORS = {
      minor:     'bg-blue-500',
      major:     'bg-orange-500',
      legendary: 'bg-yellow-500',
    } as const;

    return (
      <Card
        key={user.id}
        className={`relative overflow-visible ${
          isCurrentUser && position > 3 ? 'ring-2 ring-success bg-success/10' : getPositionStyles(position)
        }`}
      >
        {isCurrentUser && isPodium && (
          <div className="absolute top-2 left-2 w-4 h-4 bg-success rounded-full shadow-xl shadow-success/70 animate-pulse z-10" />
        )}

        {/* Per-tier challenge flags hanging from bottom-right corner */}
        <div className="absolute flex gap-1 z-10" style={{ bottom: -20, right: 14 }}>
          {TIERS.map(tier => {
            const count = counts[tier];
            if (!count) return null;
            return (
              <div
                key={tier}
                className={`${FLAG_COLORS[tier]} text-white text-[10px] font-bold w-6 flex items-start justify-center pt-1 leading-none select-none`}
                style={{ clipPath: 'polygon(0 0, 100% 0, 100% 78%, 50% 100%, 0 78%)', height: 28 }}
              >
                {count}
              </div>
            );
          })}
        </div>

        {/* Active challenge swords icon — bottom-right whitespace inside card */}
        {user.challenge_active && (
          <div className="absolute bottom-3.5 right-3 z-10">
            <Swords className="w-[18px] h-[18px] text-primary" />
          </div>
        )}

        <CardHeader className="pt-3 pb-2">
          <UserCardHeader
            user={user}
            position={position}
            level={stats.level}
            initials={initials}
            titles={titles}
          />
          <LevelProgress
            xpProgress={stats.xpProgress}
            xpLeftForNextLevel={stats.xpLeftForNextLevel}
          />
        </CardHeader>

        <CardContent className="p-4 pt-0">
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

  // Display order: 2nd (left) → 1st (center, highest) → 3rd (right)
  // mt-* steps down from top: 2nd=2.5rem, 1st=0, 3rd=5rem
  const podiumSlots =
    podiumUsers.length === 3
      ? [
          { user: podiumUsers[1], mt: 'mt-10' },
          { user: podiumUsers[0], mt: 'mt-0' },
          { user: podiumUsers[2], mt: 'mt-20' },
        ]
      : podiumUsers.length === 2
        ? [
            { user: podiumUsers[1], mt: 'mt-8' },
            { user: podiumUsers[0], mt: 'mt-0' },
          ]
        : [{ user: podiumUsers[0], mt: 'mt-0' }];

  return (
    <div className="space-y-6">
      <div className="text-center">
        <p className="text-lg font-semibold text-foreground mb-2">🏆 Leaderboard 🏆</p>
      </div>

      {/* ── Podium (top 3): mobile stacks 1/2/3, md+ shows stepped layout ── */}

      {/* Mobile: simple ordered list */}
      <div className="md:hidden space-y-6">
        {podiumUsers.map((user) => renderCard(user))}
      </div>

      {/* Desktop: 2nd left, 1st center + higher, 3rd right + lower */}
      <div className="hidden md:flex gap-6 justify-center">
        {podiumSlots.map(({ user, mt }) => (
          <div key={user.id} className={`w-[340px] ${mt}`}>
            {renderCard(user)}
          </div>
        ))}
      </div>

      {/* ── Positions 4+: flat grid, all on the same level ── */}
      {restUsers.length > 0 && (
        <div className="flex flex-wrap justify-center gap-6">
          {restUsers.map((user) => (
            <div key={user.id} className="w-[340px]">
              {renderCard(user)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
