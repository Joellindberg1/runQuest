
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Calendar, Trophy, Zap, Target } from 'lucide-react';
import { backendApi } from '@/services/backendApi';
import { User } from '@/types/run';
import { getLevelFromXP } from '@/utils/xpCalculation';
import { ShowMoreButton } from '@/components/ui/ShowMoreButton';
import { StravaIcon } from '@/components/ui/StravaIcon';

interface RunWithUser {
  id: string;
  user_id: string;
  date: string;
  distance: number;
  xp_gained: number;
  multiplier: number;
  streak_day: number;
  base_xp: number;
  km_xp: number;
  distance_bonus: number;
  streak_bonus: number;
  source?: string;
  user_name: string;
  user_level: number;
  user_profile_picture?: string;
}

interface RunHistoryGroupProps {
  users?: User[];
}

export const RunHistoryGroup: React.FC<RunHistoryGroupProps> = ({ users = [] }) => {
  const [runs, setRuns] = useState<RunWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const fetchRuns = async () => {
    try {
      console.log('=== FETCHING GROUP RUN HISTORY ===');
      
      const result = await backendApi.getGroupRunHistory();

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to fetch group run history');
      }

      console.log('✅ Group runs loaded:', result.data.length);

      const runsWithUser: RunWithUser[] = result.data.map((run: any) => ({
        id: run.id,
        user_id: run.user_id,
        date: run.date,
        distance: run.distance,
        xp_gained: run.xp_gained,
        multiplier: run.multiplier,
        streak_day: run.streak_day,
        base_xp: run.base_xp,
        km_xp: run.km_xp,
        distance_bonus: run.distance_bonus,
        streak_bonus: run.streak_bonus,
        source: run.source,
        user_name: run.user_name,
        user_level: run.user_level,
        user_profile_picture: run.user_profile_picture
      }));

      setRuns(runsWithUser);
    } catch (error) {
      console.error('Error fetching group runs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRuns();
  }, []);

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
        <div className="text-2xl text-gray-500 mb-2">No runs found</div>
        <div className="text-gray-400">Start logging runs to see them here!</div>
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
          <Card key={run.id} className="overflow-hidden bg-gradient-to-r from-blue-50 via-white to-purple-50 border-l-4 border-l-blue-500 hover:shadow-lg transition-all duration-300">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-4">
                  <div className="flex flex-col items-center gap-2 w-12">
                    <Avatar className="w-12 h-12 border-2 border-blue-200">
                      <AvatarImage src={run.user_profile_picture} alt={run.user_name} />
                      <AvatarFallback className="bg-blue-100 text-blue-700 font-bold">
                        {run.user_name.split(' ').map(n => n[0]).join('').slice(0, 2)}
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
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        {new Date(run.date).toLocaleDateString('en-US', {
                          weekday: 'short',
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric'
                        })}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 bg-gradient-to-r from-blue-500 to-purple-500 text-white px-2 py-1 rounded-full text-xs font-bold">
                        <Trophy className="w-3 h-3" />
                        Lvl {run.user_level}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-purple-600 mb-1">
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
                <div className="text-center p-3 bg-white rounded-lg shadow-sm">
                  <div className="text-2xl font-bold text-orange-500 mb-1">{run.streak_day}</div>
                  <div className="text-xs text-gray-600 uppercase tracking-wide">Streak Day</div>
                </div>
                <div className="text-center p-3 bg-white rounded-lg shadow-sm">
                  <div className="text-2xl font-bold text-purple-500 mb-1">{run.multiplier.toFixed(1)}x</div>
                  <div className="text-xs text-gray-600 uppercase tracking-wide">Multiplier</div>
                </div>
                <div className="text-center p-3 bg-white rounded-lg shadow-sm">
                  <div className="text-2xl font-bold text-blue-500 mb-1">{run.base_xp}</div>
                  <div className="text-xs text-gray-600 uppercase tracking-wide">Base XP</div>
                </div>
                <div className="text-center p-3 bg-white rounded-lg shadow-sm">
                  <div className="text-2xl font-bold text-green-500 mb-1">+{run.distance_bonus}</div>
                  <div className="text-xs text-gray-600 uppercase tracking-wide">Distance Bonus</div>
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
