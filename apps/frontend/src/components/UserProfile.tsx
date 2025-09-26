
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { User, Trophy, Calendar, Star, ChevronDown, Crown, Target, Pen } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { runService } from '@/services/runService';
import { UserTitle, User as UserType, Run } from '@/types/run';
import { EditRunDialog } from './EditRunDialog';

interface UserProfileProps {
  user: UserType;
}

export const UserProfile: React.FC<UserProfileProps> = ({ user }) => {
  const [visibleRuns, setVisibleRuns] = useState(5);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [userTitles, setUserTitles] = useState<UserTitle[]>([]);
  const [allTitles, setAllTitles] = useState<any[]>([]);
  const [editingRun, setEditingRun] = useState<Run | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);

  // Level system with exact XP requirements as specified
  const levelXpRequirements = [
    0, 50, 102.5, 158.15, 217.139, 280.84712, 349.6518896, 423.9610408, 504.9580155, 594.0546878,
    693.8429607, 806.6037091, 934.0233548, 1079.281751, 1244.876322, 1436.966025, 1659.790081, 1920.494226,
    2228.125117, 2591.129568, 3026.73491, 3549.46132, 4181.960276, 4953.609002, 5902.736936, 7089.146852,
    8584.023347, 10482.5165, 12912.58773, 16071.68033
  ];

  const getXPForLevel = (level: number) => {
    return level <= 30 ? levelXpRequirements[level - 1] : levelXpRequirements[29];
  };

  const getCurrentLevel = (xp: number) => {
    for (let i = levelXpRequirements.length - 1; i >= 0; i--) {
      if (xp >= levelXpRequirements[i]) {
        return Math.min(i + 1, 30);
      }
    }
    return 1;
  };

  const currentLevel = user.current_level;
  const currentLevelXP = getXPForLevel(currentLevel);
  const nextLevelXP = currentLevel < 30 ? getXPForLevel(currentLevel + 1) : currentLevelXP;
  const xpProgress = currentLevel < 30 ? ((user.total_xp - currentLevelXP) / (nextLevelXP - currentLevelXP)) * 100 : 100;

  const getStreakMultiplier = (streak: number) => {
    if (streak >= 270) return 2.0;
    if (streak >= 240) return 1.9;
    if (streak >= 220) return 1.8;
    if (streak >= 180) return 1.7;
    if (streak >= 120) return 1.6;
    if (streak >= 90) return 1.5;
    if (streak >= 60) return 1.4;
    if (streak >= 30) return 1.3;
    if (streak >= 15) return 1.2;
    if (streak >= 5) return 1.1;
    return 1.0;
  };

  const currentMultiplier = getStreakMultiplier(user.current_streak);

  const fetchTitleData = async () => {
    try {
      const [titles, titleHolders] = await Promise.all([
        runService.getUserTitles(user.id),
        runService.getTitleHolders()
      ]);
      
      setUserTitles(titles);
      setAllTitles(titleHolders);
    } catch (error) {
      console.error('Error fetching title data:', error);
    }
  };

  useEffect(() => {
    fetchTitleData();
  }, [user.id]);

  const showMoreRuns = () => {
    setVisibleRuns(prev => prev + 10);
  };

  const handleEditRun = (run: Run, event: React.MouseEvent) => {
    event.stopPropagation();
    setEditingRun(run);
    setShowEditDialog(true);
  };

  const handleRunUpdated = () => {
    // Trigger a refresh of the user data
    window.location.reload();
  };

  const renderRunDetails = (run: Run) => (
    <div className="mt-2 text-xs text-gray-600 bg-gray-50 p-2 rounded">
      <div>Base XP: {run.base_xp}</div>
      <div>Distance XP: {run.km_xp} ({run.distance.toFixed(1)}km × 2)</div>
      <div>Multiplier: {run.multiplier}x</div>
      <div>Distance Bonus: {run.distance_bonus}</div>
      <div>Streak Bonus: {run.streak_bonus}</div>
      <div className="font-semibold mt-1">Total: {run.xp_gained} XP</div>
    </div>
  );

  const getValueSuffix = (titleName: string) => {
    if (titleName.includes('Daaaaaviiiiiid GOGGINGS')) return ' days';
    if (titleName.includes('Weekend Destroyer')) return 'km avg';
    return 'km';
  };

  const renderTitleSection = () => {
    const heldTitles = userTitles.filter(title => title.is_current_holder);
    const runnerUpTitles = userTitles.filter(title => !title.is_current_holder);

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="w-5 h-5" />
            My Titles
          </CardTitle>
        </CardHeader>
        <CardContent>
          {heldTitles.length === 0 && runnerUpTitles.length === 0 ? (
            <div className="text-center py-4 text-gray-500">
              No titles or runner-up positions yet
            </div>
          ) : (
            <div className="space-y-4">
              {heldTitles.length > 0 && (
                <div>
                  <h4 className="font-semibold text-green-700 mb-2">🏆 Title Holder</h4>
                  {heldTitles.map((title, index) => {
                    const titleData = allTitles.find(t => t.name === title.title_name);
                    const runnerUp = titleData?.runners_up?.[0];
                    
                    return (
                      <div key={index} className="p-3 bg-green-50 border border-green-200 rounded-lg">
                        <div className="font-medium">{title.title_name}</div>
                        <div className="text-sm text-gray-600">
                          Your Record: {title.value?.toFixed(1)}{getValueSuffix(title.title_name)}
                        </div>
                        {runnerUp && (
                          <div className="text-xs text-gray-500 mt-1">
                            Runner-up: {runnerUp.user_name} ({runnerUp.value.toFixed(1)}{getValueSuffix(title.title_name)})
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              
              {runnerUpTitles.length > 0 && (
                <div>
                  <h4 className="font-semibold text-orange-700 mb-2">🥈 Runner-up</h4>
                  {runnerUpTitles.map((title, index) => {
                    const titleData = allTitles.find(t => t.name === title.title_name);
                    
                    return (
                      <div key={index} className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                        <div className="font-medium">{title.title_name}</div>
                        <div className="text-sm text-gray-600">
                          Your Record: {title.value?.toFixed(1)}{getValueSuffix(title.title_name)}
                        </div>
                        {titleData && (
                          <div className="text-xs text-gray-500 mt-1">
                            Current Holder: {titleData.holder_name} ({titleData.current_value?.toFixed(1)}{getValueSuffix(title.title_name)})
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Profile Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="w-5 h-5" />
            {user.name}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-6 mb-6">
            <div className="flex flex-col items-center gap-3">
              <Avatar className="h-24 w-24">
                <AvatarImage src={user.profile_picture || ''} />
                <AvatarFallback className="text-lg font-semibold">
                  {getInitials(user.name)}
                </AvatarFallback>
              </Avatar>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 flex-1">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">Lvl {user.current_level}</div>
                <div className="text-sm text-gray-600">Level</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{user.total_xp.toLocaleString()}</div>
                <div className="text-sm text-gray-600">Total XP</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">{user.total_km.toFixed(1)}</div>
                <div className="text-sm text-gray-600">Total KM</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600">{user.current_streak}</div>
                <div className="text-sm text-gray-600">Day Streak</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Level Progress */}
      <Card>
        <CardHeader>
          <CardTitle>Level Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Level {currentLevel}</span>
              <span>Level {Math.min(currentLevel + 1, 30)}</span>
            </div>
            <Progress value={Math.max(0, Math.min(100, xpProgress))} className="h-3 border border-black" />
            <div className="text-center text-sm text-gray-600">
              {currentLevel < 30 ? `${(nextLevelXP - user.total_xp).toLocaleString()} XP until next level` : 'Max Level Reached!'}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Title Section */}
      {renderTitleSection()}

      {/* Streak Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Streak Stats
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center p-4 bg-orange-50 rounded-lg">
              <div className="text-xl font-bold text-orange-600">{user.current_streak}</div>
              <div className="text-sm text-gray-600">Current Streak</div>
            </div>
            <div className="text-center p-4 bg-yellow-50 rounded-lg">
              <div className="text-xl font-bold text-yellow-600">{currentMultiplier}x</div>
              <div className="text-sm text-gray-600">XP Multiplier</div>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <div className="text-xl font-bold text-green-600">{user.longest_streak}</div>
              <div className="text-sm text-gray-600">Longest Streak</div>
            </div>
          </div>
          <div className="mt-4 text-sm text-gray-600">
            Keep running daily (min 1.6km) to maintain your streak and multiplier!
          </div>
        </CardContent>
      </Card>

      {/* Run History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="w-5 h-5" />
            Run History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {user.runs.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-gray-500 mb-2">No runs logged yet</div>
              <div className="text-sm text-gray-400">Start logging your runs to see them here!</div>
            </div>
          ) : (
            <div className="space-y-3">
              {user.runs.slice(0, visibleRuns).map((run) => (
                <div key={run.id} className="border rounded-lg">
                  <div 
                    className="flex items-center justify-between p-3 bg-gray-50 cursor-pointer hover:bg-gray-100"
                    onClick={() => setSelectedRun(selectedRun?.id === run.id ? null : run)}
                  >
                    <div className="flex-1">
                      <div className="font-semibold">{run.date}</div>
                      <div className="text-sm text-gray-600">
                        {run.distance.toFixed(1)}km • Streak Day {run.streak_day}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <div className="font-bold text-green-600">+{run.xp_gained} XP</div>
                        <div className="text-sm text-gray-600">{run.multiplier}x multiplier</div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => handleEditRun(run, e)}
                        className="ml-2"
                      >
                        <Pen className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  {selectedRun?.id === run.id && renderRunDetails(run)}
                </div>
              ))}
              
              {visibleRuns < user.runs.length && (
                <div className="text-center pt-4">
                  <Button onClick={showMoreRuns} variant="outline">
                    <ChevronDown className="w-4 h-4 mr-2" />
                    Show More Runs
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <EditRunDialog
        run={editingRun}
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        onRunUpdated={handleRunUpdated}
      />
    </div>
  );
};
