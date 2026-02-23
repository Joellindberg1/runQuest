import React, { useState, useEffect } from 'react';
import { Leaderboard } from '@/features/leaderboard';
import { RunLogger } from '@/features/runs';
import { UserProfile } from '@/features/profile';
import { TitleSystem } from '@/features/titles';
import { ProfileMenu } from '@/features/profile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import { Trophy, User as UserIcon, Plus, Award } from 'lucide-react';
import { useLeaderboardData } from '@/features/leaderboard/hooks/useLeaderboardData';
import { toast } from 'sonner';

const Index: React.FC = () => {
  const { users, currentUser, loading, refresh } = useLeaderboardData();
  const [activeTab, setActiveTab] = useState("leaderboard");

  // Listen for run updates and refresh all data
  useEffect(() => {
    const handleRunUpdate = async () => {
      await refresh();
      toast.success('Data refreshed after run update!');
    };

    window.addEventListener('runsUpdated', handleRunUpdate);
    return () => window.removeEventListener('runsUpdated', handleRunUpdate);
  }, [refresh]);

  const handleRunSubmit = async () => {
    await refresh();
    toast.success('Data refreshed!');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center">
        <div className="text-xl">Loading...</div>
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
              <UserIcon className="w-4 h-4" />
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
            <Leaderboard users={users} currentUser={currentUser} />
          </TabsContent>

          <TabsContent value="titles">
            <TitleSystem users={users} />
          </TabsContent>

          <TabsContent value="profile">
            <UserProfile user={currentUser} allUsers={users} />
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
