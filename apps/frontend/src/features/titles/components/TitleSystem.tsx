
import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Crown } from 'lucide-react';
import { backendApi } from '@/shared/services/backendApi';
import { toast } from 'sonner';
import { log } from '@/shared/utils/logger';
import { TitleCard } from './title/TitleCard';
import { TitleRequirements } from './title/TitleRequirements';
import { User, Title } from './title/titleSystemUtils';

interface TitleSystemProps {
  users: User[];
}

export const TitleSystem: React.FC<TitleSystemProps> = ({ users }) => {
  const [titles, setTitles] = useState<Title[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter out admin users
  const filteredUsers = users.filter(user => user.name.toLowerCase() !== 'admin');

  // Fetch titles using the new direct query approach
  const fetchTitles = async () => {
    try {
      log.debug('Fetching titles using direct query approach');
      
      // First trigger backend title calculation to ensure fresh data
      try {
        await backendApi.refreshTitleLeaderboards();
        log.debug('Backend title calculation triggered');
      } catch (error) {
        log.warn('Backend title calculation failed, using cached data', error);
      }
      
      const titleResponse = await backendApi.getTitleLeaderboard();
      const titleHolders = titleResponse.success ? titleResponse.data : [];
      log.debug('Titles loaded', titleHolders);
      
      setTitles(titleHolders);
    } catch (error) {
      console.error('Error fetching titles:', error);
      toast.error('Failed to load titles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTitles();
  }, []);

  // Auto-refresh when users change (when runs are added/removed)
  useEffect(() => {
    if (!loading && users.length > 0) {
      log.debug('Users changed, auto-refreshing titles');
      fetchTitles();
    }
  }, [users]);

  // Listen for custom events from run updates/deletions
  useEffect(() => {
    const handleRunUpdate = () => {
      log.debug('Run updated event received, refreshing titles');
      fetchTitles();
    };

    window.addEventListener('runsUpdated', handleRunUpdate);
    
    return () => {
      window.removeEventListener('runsUpdated', handleRunUpdate);
    };
  }, [fetchTitles]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
          <div className="text-lg">Loading titles...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Competitive Titles */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Crown className="w-6 h-6 text-yellow-500" />
            <CardTitle>Competitive Titles</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">
            Fight for four exclusive titles that change hands when records are broken
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {titles.map((title) => (
              <TitleCard key={title.id} title={title} />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Title Requirements */}
      <TitleRequirements users={filteredUsers} />
    </div>
  );
};

