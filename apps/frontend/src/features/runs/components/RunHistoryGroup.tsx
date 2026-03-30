import React, { useState } from 'react';
import { Card, CardContent, CardTitle } from '@/shared/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar';
import { Calendar, Trophy, Zap } from 'lucide-react';
import type { User } from '@runquest/types';
import { ShowMoreButton } from '@/shared/components/ShowMoreButton';
import { StravaIcon } from '@/shared/components/StravaIcon';
import { getInitials, formatRunDate } from '@/shared/utils/formatters';
import { useGroupRunHistory } from '../hooks/useGroupRunHistory';

interface RunHistoryGroupProps {
  users?: User[];
}

export const RunHistoryGroup: React.FC<RunHistoryGroupProps> = ({ users = [] }) => {
  const { runs, loading } = useGroupRunHistory();
  const [showAll, setShowAll] = useState(false);

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="text-lg">Loading run history...</div>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-2xl text-muted-foreground mb-2">No runs found</div>
        <div className="text-muted-foreground">Start logging runs to see them here!</div>
      </div>
    );
  }

  const displayRuns = showAll ? runs : runs.slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2">🏃‍♂️ Group Run History 🏃‍♀️</h2>
      </div>

      <div className="grid gap-6">
        {displayRuns.map((run) => (
          <Card key={run.id} className="overflow-hidden bg-sidebar border-2 border-foreground/15 border-l-4 border-l-primary hover:shadow-lg transition-all duration-300">
            <CardContent className="p-4 md:p-6">
              {/*
                Mobile: 2-col grid
                  Row 1: User info | Km + XP
                  Row 2: Streak Day | Multiplier
                  Row 3: Base XP | Km XP
                  Row 4: Distance Bonus (col-span-2)
                Desktop: 4-col × 2-row grid
              */}
              <div className="grid grid-cols-2 gap-4 md:grid-cols-[auto_1fr_1fr_1fr] md:grid-rows-2 md:items-center">

                {/* Col 1: User info – top-left aligned, spans both rows on desktop */}
                <div className="md:row-span-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 items-start self-start">
                  <Avatar className="w-12 h-12 border-2 border-foreground/20 row-span-2">
                    <AvatarImage src={run.user_profile_picture} alt={run.user_name} />
                    <AvatarFallback className="bg-background text-foreground font-bold">
                      {getInitials(run.user_name)}
                    </AvatarFallback>
                  </Avatar>
                  <CardTitle className="text-xl truncate">
                    {run.user_name}
                  </CardTitle>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground col-start-2">
                    <Calendar className="w-4 h-4" />
                    {formatRunDate(run.date)}
                  </div>
                  <div className="flex items-center gap-2 col-span-2 mt-1">
                    {run.source === 'strava' && (
                      <div className="opacity-80">
                        <StravaIcon size={28} />
                      </div>
                    )}
                    <div className="flex items-center gap-1 bg-primary text-primary-foreground px-2 py-1 rounded-full text-xs font-bold">
                      <Trophy className="w-3 h-3" />
                      Lvl {run.user_level}
                    </div>
                  </div>
                  <div className="col-span-2 mt-1 flex">
                    {run.is_treadmill === true && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30">
                        Treadmill
                      </span>
                    )}
                    {run.is_treadmill === false && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-500/15 text-green-500 border border-green-500/30">
                        Outdoor
                      </span>
                    )}
                  </div>
                </div>

                {/* Mobile row 1 col 2 / Desktop col 4 row 1: Distance + XP */}
                <div className="text-right flex flex-col items-end justify-start md:order-none order-none md:col-start-4 md:row-start-1">
                  <div className="text-3xl font-bold mb-1">
                    {run.distance.toFixed(1)} km
                  </div>
                  <div className="flex items-center gap-1 font-bold" style={{ color: 'var(--rq-gold)' }}>
                    <Zap className="w-4 h-4" />
                    +{run.xp_gained} XP
                  </div>
                </div>

                {/* Mobile row 2 col 1 / Desktop col 2 row 1: Streak Day */}
                <div className="text-center p-3 bg-background border border-foreground/50 rounded-lg md:col-start-2 md:row-start-1">
                  <div className="text-2xl font-bold text-foreground mb-1">{run.streak_day}</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Streak Day</div>
                </div>

                {/* Mobile row 2 col 2 / Desktop col 2 row 2: Multiplier */}
                <div className="text-center p-3 bg-background border border-foreground/50 rounded-lg md:col-start-2 md:row-start-2">
                  <div className="text-2xl font-bold text-foreground mb-1">{run.multiplier.toFixed(1)}x</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Multiplier</div>
                </div>

                {/* Mobile row 3 col 1 / Desktop col 3 row 1: Base XP */}
                <div className="text-center p-3 bg-background border border-foreground/50 rounded-lg md:col-start-3 md:row-start-1">
                  <div className="text-2xl font-bold text-foreground mb-1">{run.base_xp}</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Base XP</div>
                </div>

                {/* Mobile row 3 col 2 / Desktop col 3 row 2: Km XP */}
                <div className="text-center p-3 bg-background border border-foreground/50 rounded-lg md:col-start-3 md:row-start-2">
                  <div className="text-2xl font-bold text-foreground mb-1">{run.km_xp}</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Km XP</div>
                </div>

                {/* Mobile row 4 full-width / Desktop col 4 row 2: Distance Bonus */}
                <div className="col-span-2 md:col-span-1 text-center p-3 bg-background border border-foreground/50 rounded-lg md:col-start-4 md:row-start-2">
                  <div className="text-2xl font-bold text-foreground mb-1">+{run.distance_bonus}</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Distance Bonus</div>
                </div>

              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {runs.length > 5 && (
        <ShowMoreButton
          showAll={showAll}
          onClick={() => setShowAll(!showAll)}
          moreText="Show more..."
          lessText="Show less..."
        />
      )}
    </div>
  );
};
