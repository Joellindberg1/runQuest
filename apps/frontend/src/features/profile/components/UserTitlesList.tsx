import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Crown } from 'lucide-react';
import { useUserTitles, useTitleLeaderboard } from '@/shared/hooks/useTitleQueries';

interface UserTitlesListProps {
  userId: string;
}

const getValueSuffix = (titleName: string) => {
  if (titleName.includes('Daaaaaviiiiiid GOGGINGS')) return ' days';
  if (titleName.includes('Weekend Destroyer')) return 'km avg';
  return 'km';
};

export const UserTitlesList: React.FC<UserTitlesListProps> = ({ userId }) => {
  const { data: userTitles = [] } = useUserTitles(userId);
  const { data: allTitles = [] } = useTitleLeaderboard();

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
                      const runnerUp = titleData?.runners_up?.[0];
                      return (
                        <div key={index} className="p-3 bg-background border border-foreground/10 rounded-lg">
                          <div className="font-medium">{title.title_name}</div>
                          <div className="text-sm text-muted-foreground">
                            Your Record: {title.value?.toFixed(1)}{getValueSuffix(title.title_name)}
                          </div>
                          {runnerUp && (
                            <div className="text-xs text-muted-foreground mt-1">
                              Runner-up: {runnerUp.user_name} ({runnerUp.value.toFixed(1)}{getValueSuffix(title.title_name)})
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
                      return (
                        <div key={index} className="p-3 bg-background border border-foreground/10 rounded-lg">
                          <div className="font-medium">{title.title_name}</div>
                          <div className="text-sm text-muted-foreground">
                            Your Record: {title.value?.toFixed(1)}{getValueSuffix(title.title_name)}
                          </div>
                          {titleData && (
                            <div className="text-xs text-muted-foreground mt-1">
                              Current Holder: {titleData.holder_name} ({titleData.current_value?.toFixed(1)}{getValueSuffix(title.title_name)})
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
