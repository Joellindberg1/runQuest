import React, { useState } from 'react';
import { Card, CardContent, CardTitle } from '@/shared/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar';
import { Calendar, Trophy, Zap } from 'lucide-react';
import type { User } from '@runquest/types';
import { ShowMoreButton } from '@/shared/components/ShowMoreButton';
import { StravaIcon } from '@/shared/components/StravaIcon';
import { getInitials, formatRunDate } from '@/shared/utils/formatters';
import { useGroupRunHistory } from '../hooks/useGroupRunHistory';

function wmoWeather(code: number): { emoji: string; label: string; isPrecip: boolean } {
  if (code === 0)                       return { emoji: '☀️',  label: 'Clear',            isPrecip: false };
  if (code === 1)                       return { emoji: '🌤️', label: 'Mainly clear',      isPrecip: false };
  if (code === 2)                       return { emoji: '⛅',  label: 'Partly cloudy',     isPrecip: false };
  if (code === 3)                       return { emoji: '☁️',  label: 'Overcast',          isPrecip: false };
  if (code === 45 || code === 48)       return { emoji: '🌫️', label: 'Fog',               isPrecip: false };
  if (code >= 51 && code <= 55)         return { emoji: '🌦️', label: 'Drizzle',           isPrecip: true  };
  if (code >= 61 && code <= 65)         return { emoji: '🌧️', label: 'Rain',              isPrecip: true  };
  if (code >= 71 && code <= 77)         return { emoji: '🌨️', label: 'Snow',              isPrecip: true  };
  if (code >= 80 && code <= 82)         return { emoji: '🌧️', label: 'Rain showers',      isPrecip: true  };
  if (code === 85 || code === 86)       return { emoji: '🌨️', label: 'Snow showers',      isPrecip: true  };
  if (code === 95)                      return { emoji: '⛈️',  label: 'Thunderstorm',      isPrecip: true  };
  if (code === 96 || code === 99)       return { emoji: '⛈️',  label: 'Thunderstorm',      isPrecip: true  };
  return { emoji: '🌡️', label: 'Unknown', isPrecip: false };
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
                  {run.weather_code != null && run.temperature_c != null && (() => {
                    const w = wmoWeather(run.weather_code);
                    return (
                      <div className="col-span-2 mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span>{w.emoji}</span>
                        <span>{Math.round(run.temperature_c!)}°C</span>
                        {w.isPrecip && (
                          <span className="px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">
                            {w.label}
                          </span>
                        )}
                      </div>
                    );
                  })()}
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

                {/* Mobile row 2 col 2 / Desktop col 2 row 2: Multiplier & XP */}
                {(() => {
                  const bonus = Math.round((run.base_xp + run.km_xp) * (run.multiplier - 1));
                  const bonusColor = bonus === 0 ? undefined : bonus > 0 ? 'var(--rq-success)' : 'var(--rq-danger)';
                  const bonusLabel = bonus >= 0 ? `+${bonus}` : `${bonus}`;
                  return (
                    <div className="text-center p-3 bg-background border border-foreground/50 rounded-lg md:col-start-2 md:row-start-2">
                      <div className="text-xl font-bold text-foreground mb-1 flex items-baseline justify-center gap-1.5 flex-wrap">
                        <span>{run.multiplier.toFixed(2)}x</span>
                        <span className="text-muted-foreground font-normal text-base">=</span>
                        <span style={{ color: bonusColor }}>{bonusLabel} XP</span>
                      </div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wide">Multiplier & XP</div>
                    </div>
                  );
                })()}

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
