
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar';
import { Calendar, Trophy, Zap } from 'lucide-react';
import type { User } from '@/types/run';
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
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-4">
                  <div className="flex flex-col items-center gap-2 w-12">
                    <Avatar className="w-12 h-12 border-2 border-foreground/20">
                      <AvatarImage src={run.user_profile_picture} alt={run.user_name} />
                      <AvatarFallback className="bg-background text-foreground font-bold">
                        {getInitials(run.user_name)}
                      </AvatarFallback>
                    </Avatar>
                    {run.source === 'strava' && (
                      <div className="opacity-80">
                        <StravaIcon size={36} />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 pr-4 flex flex-col justify-start gap-2">
                    <CardTitle className="text-xl truncate">
                      {run.user_name}
                    </CardTitle>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        {formatRunDate(run.date)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 bg-primary text-primary-foreground px-2 py-1 rounded-full text-xs font-bold">
                        <Trophy className="w-3 h-3" />
                        Lvl {run.user_level}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold mb-1">
                    {run.distance.toFixed(1)} km
                  </div>
                  <div className="flex items-center gap-1 text-green-600 font-bold">
                    <Zap className="w-4 h-4" />
                    +{run.xp_gained} XP
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-3 bg-background border border-foreground/10 rounded-lg">
                  <div className="text-2xl font-bold text-orange-500 mb-1">{run.streak_day}</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Streak Day</div>
                </div>
                <div className="text-center p-3 bg-background border border-foreground/10 rounded-lg">
                  <div className="text-2xl font-bold text-purple-500 mb-1">{run.multiplier.toFixed(1)}x</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Multiplier</div>
                </div>
                <div className="text-center p-3 bg-background border border-foreground/10 rounded-lg">
                  <div className="text-2xl font-bold text-blue-500 mb-1">{run.base_xp}</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Base XP</div>
                </div>
                <div className="text-center p-3 bg-background border border-foreground/10 rounded-lg">
                  <div className="text-2xl font-bold text-green-500 mb-1">+{run.distance_bonus}</div>
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

