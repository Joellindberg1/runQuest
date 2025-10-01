
import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Crown } from 'lucide-react';
import { runService } from '@/services/runService';
import { toast } from 'sonner';
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
      console.log('🏆 Fetching titles using direct query approach...');
      
      const titleHolders = await runService.getTitleHolders();
      console.log('✅ Titles loaded:', titleHolders);
      
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

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="text-center">Loading titles...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Competitive Titles */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="w-6 h-6 text-yellow-500" />
            Competitive Titles
          </CardTitle>
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
