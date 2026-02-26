import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Button } from '@/shared/components/ui/button';
import { backendApi } from '@/shared/services/backendApi';
import { log } from '@/shared/utils/logger';

export const TitleConfig: React.FC = () => {
  const handleRefreshTitles = async () => {
    try {
      await backendApi.refreshTitleLeaderboards();
      alert('✅ Title leaderboards refreshed successfully!');
    } catch (error) {
      log.error('Failed to refresh titles', error);
      alert('❌ Failed to refresh title leaderboards');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Title Configuration</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div className="text-sm text-muted-foreground">
              Current competitive titles are hardcoded. Future updates will allow customization.
            </div>
            <Button onClick={handleRefreshTitles} className="flex items-center gap-2">
              🔄 Refresh Title Leaderboards
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 border rounded-lg">
              <h4 className="font-semibold">The Reborn Eliud Kipchoge</h4>
              <p className="text-sm text-muted-foreground">Longest single run (12km+ to unlock)</p>
            </div>
            <div className="p-4 border rounded-lg">
              <h4 className="font-semibold">The Daaaaaaaaaaaaaaaaaaaaaaaaavid GOGGINGS</h4>
              <p className="text-sm text-muted-foreground">Longest streak (20+ days to unlock)</p>
            </div>
            <div className="p-4 border rounded-lg">
              <h4 className="font-semibold">The Ultra Man</h4>
              <p className="text-sm text-muted-foreground">Most total km (100km+ to unlock)</p>
            </div>
            <div className="p-4 border rounded-lg">
              <h4 className="font-semibold">The Weekend Destroyer</h4>
              <p className="text-sm text-muted-foreground">Best weekend average (9km+ to unlock)</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
