
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Crown } from 'lucide-react';
import { TitleCard } from './title/TitleCard';
import { TitleRequirements } from './title/TitleRequirements';
import { User } from './title/titleSystemUtils';
import { useTitleSystemData } from '../hooks/useTitleSystemData';

interface TitleSystemProps {
  users: User[];
}

export const TitleSystem: React.FC<TitleSystemProps> = ({ users }) => {
  const filteredUsers = users.filter(user => user.name.toLowerCase() !== 'admin');
  const { titles, loading } = useTitleSystemData();


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

