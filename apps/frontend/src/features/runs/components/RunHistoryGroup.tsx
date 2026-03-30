
import React, { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/shared/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar';
import { Calendar, Zap } from 'lucide-react';
import type { User } from '@runquest/types';
import { ShowMoreButton } from '@/shared/components/ShowMoreButton';
import { StravaIcon } from '@/shared/components/StravaIcon';
import { getInitials, formatRunDate } from '@/shared/utils/formatters';
import { useGroupRunHistory } from '../hooks/useGroupRunHistory';

// WMO weather code → emoji
function wmoEmoji(code: number | null | undefined): string {
  if (code == null) return '';
  if (code === 0) return '☀️';
  if (code <= 3) return '⛅';
  if (code <= 48) return '🌫️';
  if (code <= 55) return '🌦️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌦️';
  if (code <= 86) return '🌨️';
  return '⛈️';
}

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

      <div className="grid gap-4">
        {displayRuns.map((run) => {
          const emoji = wmoEmoji(run.weather_code);
          const temp = run.temperature_c != null ? `${Math.round(run.temperature_c)}°` : null;

          return (
            <Card key={run.id} className="overflow-hidden bg-sidebar border-2 border-foreground/15 border-l-4 border-l-primary hover:shadow-lg transition-all duration-300">
              <CardHeader className="pb-3 pt-4 px-4">
                <div className="flex items-start justify-between gap-4">

                  {/* Left: avatar column + name/date */}
                  <div className="flex items-start gap-3">
                    {/* Stacked avatar column */}
                    <div className="flex flex-col items-center gap-1.5 shrink-0 w-10">
                      <Avatar className="w-10 h-10 border-2 border-foreground/20">
                        <AvatarImage src={run.user_profile_picture} alt={run.user_name} />
                        <AvatarFallback className="bg-background text-foreground font-bold text-xs">
                          {getInitials(run.user_name)}
                        </AvatarFallback>
                      </Avatar>
                      {run.source === 'strava' && (
                        <div className="opacity-80">
                          <StravaIcon size={24} />
                        </div>
                      )}
                      <div className="bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full text-[10px] font-bold text-center">
                        {run.user_level}
                      </div>
                      {run.is_treadmill === true && (
                        <span className="text-[10px] font-semibold px-1 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30 text-center leading-tight w-full">
                          TM
                        </span>
                      )}
                      {run.is_treadmill === false && (
                        <span className="text-[10px] font-semibold px-1 py-0.5 rounded-full bg-green-500/15 text-green-500 border border-green-500/30 text-center leading-tight w-full">
                          OUT
                        </span>
                      )}
                      {emoji && (
                        <div className="flex flex-col items-center leading-none gap-0.5">
                          <span className="text-sm">{emoji}</span>
                          {temp && <span className="text-[10px] text-muted-foreground">{temp}</span>}
                        </div>
                      )}
                    </div>

                    {/* Name + date */}
                    <div className="flex flex-col justify-start gap-1 pt-1">
                      <div className="font-semibold text-base leading-tight">{run.user_name}</div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Calendar className="w-3 h-3" />
                        {formatRunDate(run.date)}
                      </div>
                    </div>
                  </div>

                  {/* Right: distance + XP */}
                  <div className="text-right shrink-0">
                    <div className="text-2xl font-bold">{run.distance.toFixed(1)} km</div>
                    <div className="flex items-center justify-end gap-1 font-bold text-sm" style={{ color: 'var(--rq-gold)' }}>
                      <Zap className="w-3.5 h-3.5" />
                      +{run.xp_gained} XP
                    </div>
                  </div>

                </div>
              </CardHeader>

              <CardContent className="pb-3 px-4">
                <div className="grid grid-cols-2 gap-3">

                  {/* Streak Day */}
                  <div className="text-center p-3 bg-background border border-foreground/50 rounded-lg">
                    <div className="text-2xl font-bold text-foreground mb-1">{run.streak_day}</div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide">Streak Day</div>
                  </div>

                  {/* Base XP */}
                  <div className="text-center p-3 bg-background border border-foreground/50 rounded-lg">
                    <div className="text-2xl font-bold text-foreground mb-1">{run.base_xp}</div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide">Base XP</div>
                  </div>

                  {/* Multiplier */}
                  <div className="text-center p-3 bg-background border border-foreground/50 rounded-lg">
                    <div className="text-2xl font-bold text-foreground mb-1">{run.multiplier.toFixed(1)}x</div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide">Multiplier</div>
                  </div>

                  {/* Km XP */}
                  <div className="text-center p-3 bg-background border border-foreground/50 rounded-lg">
                    <div className="text-2xl font-bold text-foreground mb-1">{run.km_xp}</div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide">Km XP</div>
                  </div>

                </div>
              </CardContent>
            </Card>
          );
        })}
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
