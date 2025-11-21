import React, { useState, useEffect } from 'react';
import { Leaderboard } from '@/components/Leaderboard';
import { RunLogger } from '@/components/RunLogger';
import { UserProfile } from '@/components/UserProfile';
import { TitleSystem } from '@/components/TitleSystem';
import { ProfileMenu } from '@/components/ProfileMenu';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Trophy, User, Plus, Award, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { backendApi } from '@/services/backendApi';
import { runService } from '@/services/runService';
import { toast } from 'sonner';
import { getLevelFromXP } from '@/utils/xpCalculation';
import { logger } from '@/utils/logger';

interface Run {
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
}

interface User {
  id: string;
  name: string;
  total_xp: number;
  current_level: number;
  total_km: number;
  current_streak: number;
  longest_streak: number;
  profile_picture?: string;
  runs: Run[];
}

const Index: React.FC = () => {
  const { user: authUser, session, logout } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState("leaderboard");
  const [loading, setLoading] = useState(true);

  const fetchUsers = async () => {
    try {
      const result = await backendApi.getUsersWithRuns();
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to fetch users');
      }

      const usersWithRuns = result.data.map((user: any) => ({
        id: user.id,
        name: user.name,
        total_xp: user.total_xp || 0,
        current_level: user.current_level || 1,
        total_km: parseFloat(user.total_km?.toString() || '0'),
        current_streak: user.current_streak || 0,
        longest_streak: user.longest_streak || 0,
        profile_picture: user.profile_picture || undefined,
        runs: user.runs?.map((run: any) => ({
          id: run.id,
          user_id: run.user_id,
          date: run.date,
          distance: parseFloat(run.distance.toString()),
          xp_gained: run.xp_gained,
          multiplier: parseFloat(run.multiplier.toString()),
          streak_day: run.streak_day,
          base_xp: run.base_xp,
          km_xp: run.km_xp,
          distance_bonus: run.distance_bonus,
          streak_bonus: run.streak_bonus
        })) || []
      }));

      setUsers(usersWithRuns);
      
      // Find and set current user
      if (authUser) {
        const current = usersWithRuns.find((u: any) => u.id === authUser.id);
        setCurrentUser(current || null);
      }
    } catch (error) {
      logger.error('Failed to fetch users', error);
      toast.error('Failed to load user data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authUser) {
      fetchUsers();
    } else {
      setLoading(false);
    }
  }, [authUser]);

  // Listen for run updates and refresh all data
  useEffect(() => {
    const handleRunUpdate = async (event: any) => {
      await fetchUsers();
      toast.success('Data refreshed after run update!');
    };

    window.addEventListener('runsUpdated', handleRunUpdate);
    
    return () => {
      window.removeEventListener('runsUpdated', handleRunUpdate);
    };
  }, []);

  const handleRunSubmit = async () => {
    await fetchUsers(); // Refresh all data after run submission
    toast.success('Data refreshed!');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center">
        <div className="text-xl">Please log in to access the app</div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center">
        <div className="text-xl">User not found</div>
      </div>
    );
  }

  // Sort users by level first, then by XP
  const sortedUsers = [...users].sort((a, b) => {
    const aLevel = getLevelFromXP(a.total_xp);
    const bLevel = getLevelFromXP(b.total_xp);
    if (aLevel !== bLevel) {
      return bLevel - aLevel;
    }
    return b.total_xp - a.total_xp;
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-4">
      <div className="max-w-6xl mx-auto">
        <header className="text-center mb-8">
          <div className="flex justify-between items-center">
            <div></div>
            <div>
              <h1 className="text-4xl font-bold text-gray-800 mb-2">Göteborgsvarvet 2026</h1>
              <p className="text-lg text-gray-600">Run - Rank - Reign</p>
            </div>
            <div>
              <ProfileMenu />
            </div>
          </div>
        </header>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-6 bg-white border-2 border-gray-200 shadow-lg">
            <TabsTrigger 
              value="leaderboard" 
              className="flex items-center gap-2 data-[state=active]:bg-blue-500 data-[state=active]:text-white font-semibold"
            >
              <Trophy className="w-4 h-4" />
              Leaderboard
            </TabsTrigger>
            <TabsTrigger 
              value="titles" 
              className="flex items-center gap-2 data-[state=active]:bg-blue-500 data-[state=active]:text-white font-semibold"
            >
              <Award className="w-4 h-4" />
              Titles
            </TabsTrigger>
            <TabsTrigger 
              value="profile" 
              className="flex items-center gap-2 data-[state=active]:bg-blue-500 data-[state=active]:text-white font-semibold"
            >
              <User className="w-4 h-4" />
              Profile
            </TabsTrigger>
            <TabsTrigger 
              value="log-run" 
              className="flex items-center gap-2 data-[state=active]:bg-blue-500 data-[state=active]:text-white font-semibold"
            >
              <Plus className="w-4 h-4" />
              Log Run
            </TabsTrigger>
          </TabsList>

          <TabsContent value="leaderboard">
            <Leaderboard users={sortedUsers} currentUser={currentUser} />
          </TabsContent>

          <TabsContent value="titles">
            <TitleSystem users={users} />
          </TabsContent>

          <TabsContent value="profile">
            <UserProfile user={currentUser} />
          </TabsContent>

          <TabsContent value="log-run">
            <RunLogger onSubmit={handleRunSubmit} users={users} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Index;
