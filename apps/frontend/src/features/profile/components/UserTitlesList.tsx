import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Crown } from 'lucide-react';
import { useUserTitles, useTitleLeaderboard, useAllTitles } from '@/shared/hooks/useTitleQueries';
import { formatTitleValue } from '@/features/titles/components/title/titleSystemUtils';

interface UserTitlesListProps {
  userId: string;
}

export const UserTitlesList: React.FC<UserTitlesListProps> = ({ userId }) => {
  const { data: userTitles = [] } = useUserTitles(userId);
  const { data: allTitles = [] } = useTitleLeaderboard();
  const { data: titleDefs = [] } = useAllTitles();

  const heldTitles = userTitles.filter((title) => title.is_current_holder);
  const runnerUpTitles = userTitles.filter((title) => !title.is_current_holder);

  return (
    <Card className="bg-sidebar border-2 border-foreground/15">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Crown className="w-5 h-5" />
          My Titles
        </CardTitle>
      </CardHeader>
      <CardContent>
        {heldTitles.length === 0 && runnerUpTitles.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground">
            No titles or runner-up positions yet
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left: Title Holder */}
            <div>
              {heldTitles.length > 0 && (
                <>
                  <h4 className="font-semibold mb-2">🏆 Title Holder</h4>
                  <div className="space-y-3">
                    {heldTitles.map((title, index) => {
                      const titleData = allTitles.find((t) => t.name === title.title_name);
                      const titleDef = titleDefs.find((t) => t.id === title.title_id);
                      const metricKey = titleDef?.metric_key;
                      const runnerUp = titleData?.runners_up?.[0];
                      return (
                        <div key={index} className="p-3 bg-background border border-foreground/50 rounded-lg">
                          <div className="font-medium">{title.title_name}</div>
                          <div className="text-sm text-muted-foreground">
                            Your Record: {formatTitleValue(metricKey, title.value ?? 0)}
                          </div>
                          {runnerUp && (
                            <div className="text-xs text-muted-foreground mt-1">
                              Runner-up: {runnerUp.user_name} ({formatTitleValue(metricKey, runnerUp.value)})
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Right: Runner-up */}
            <div>
              {runnerUpTitles.length > 0 && (
                <>
                  <h4 className="font-semibold mb-2">🥈 Runner-up</h4>
                  <div className="space-y-3">
                    {runnerUpTitles.map((title, index) => {
                      const titleData = allTitles.find((t) => t.name === title.title_name);
                      const titleDef = titleDefs.find((t) => t.id === title.title_id);
                      const metricKey = titleDef?.metric_key;
                      const holder = titleData?.holder;
                      return (
                        <div key={index} className="p-3 bg-background border border-foreground/50 rounded-lg">
                          <div className="font-medium">{title.title_name}</div>
                          <div className="text-sm text-muted-foreground">
                            Your Record: {formatTitleValue(metricKey, title.value ?? 0)}
                          </div>
                          {holder && (
                            <div className="text-xs text-muted-foreground mt-1">
                              Current Holder: {holder.user_name} ({formatTitleValue(metricKey, holder.value)})
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
