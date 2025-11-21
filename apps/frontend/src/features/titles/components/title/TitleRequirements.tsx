
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { UserTitleStatus } from './UserTitleStatus';
import { User } from './titleSystemUtils';

interface TitleRequirementsProps {
  users: User[];
}

export const TitleRequirements: React.FC<TitleRequirementsProps> = ({ users }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>How Title Competition Works</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="p-4 bg-blue-50 rounded-lg">
            <h4 className="font-semibold mb-2">Title Rules:</h4>
            <ul className="text-sm space-y-1 text-muted-foreground">
              <li>• Each title has a minimum requirement to unlock</li>
              <li>• Once unlocked, you must beat the current holder to claim the title</li>
              <li>• Titles change hands immediately when records are broken</li>
              <li>• Weekend average is calculated per complete weekend (Sat + Sun totals)</li>
            </ul>
          </div>
          
          {users.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {users.map(user => (
                <UserTitleStatus key={user.id} user={user} />
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="text-gray-500 mb-2">No users to display</div>
              <div className="text-sm text-gray-400">Start logging runs to compete for titles!</div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

