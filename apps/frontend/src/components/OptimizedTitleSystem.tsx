/**
 * Modern TitleSystem component using React Query for optimal performance
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Crown, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { TitleCard } from './title/TitleCard';
import { TitleRequirements } from './title/TitleRequirements';
import { User } from './title/titleSystemUtils';
import { useTitleLeaderboard, useRefreshTitleLeaderboards } from '@/hooks/useTitleQueries';

interface OptimizedTitleSystemProps {
  users: User[];
}

export const OptimizedTitleSystem: React.FC<OptimizedTitleSystemProps> = ({ users }) => {
  const { 
    data: titles = [], 
    isLoading, 
    error, 
    refetch 
  } = useTitleLeaderboard();
  
  const refreshMutation = useRefreshTitleLeaderboards();

  // Filter out admin users
  const filteredUsers = users.filter(user => user.name.toLowerCase() !== 'admin');

  const handleRefresh = async () => {
    try {
      await refreshMutation.mutateAsync();
      toast.success('Title leaderboards refreshed successfully!');
    } catch (error) {
      console.error('Error refreshing titles:', error);
      toast.error('Failed to refresh title leaderboards');
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
          <div className="text-lg">Loading titles...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <Card className="border-red-200">
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="text-red-500 mb-4">⚠️ Error loading titles</div>
              <Button onClick={() => refetch()} variant="outline">
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Competitive Titles */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Crown className="w-6 h-6 text-yellow-500" />
              <CardTitle>Competitive Titles</CardTitle>
            </div>
            <Button 
              onClick={handleRefresh}
              variant="outline"
              size="sm"
              disabled={refreshMutation.isPending}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Fight for four exclusive titles that change hands when records are broken
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {titles.map(title => (
              <TitleCard 
                key={title.id} 
                title={{
                  ...title,
                  current_holder_id: title.holder?.user_id || null,
                  current_value: title.holder?.value || null,
                  holder_name: title.holder?.user_name || undefined,
                  runners_up: title.runners_up.map(runner => ({
                    user_id: runner.user_id,
                    user_name: runner.user_name,
                    value: runner.value
                  }))
                }} 
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Title Requirements */}
      <TitleRequirements users={filteredUsers} />
    </div>
  );
};