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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Crown className="w-5 h-5" />
          My Titles
        </CardTitle>
      </CardHeader>
      <CardContent>
        {heldTitles.length === 0 && runnerUpTitles.length === 0 ? (
          <div className="text-center py-4 text-gray-500">
            No titles or runner-up positions yet
          </div>
        ) : (
          <div className="space-y-4">
            {heldTitles.length > 0 && (
              <div>
                <h4 className="font-semibold text-green-700 mb-2">🏆 Title Holder</h4>
                <div className="space-y-3">
                  {heldTitles.map((title, index) => {
                    const titleData = allTitles.find((t) => t.name === title.title_name);
                    const runnerUp = titleData?.runners_up?.[0];
                    return (
                      <div key={index} className="p-3 bg-green-50 border border-green-200 rounded-lg">
                        <div className="font-medium">{title.title_name}</div>
                        <div className="text-sm text-gray-600">
                          Your Record: {title.value?.toFixed(1)}{getValueSuffix(title.title_name)}
                        </div>
                        {runnerUp && (
                          <div className="text-xs text-gray-500 mt-1">
                            Runner-up: {runnerUp.user_name} ({runnerUp.value.toFixed(1)}{getValueSuffix(title.title_name)})
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {runnerUpTitles.length > 0 && (
              <div>
                <h4 className="font-semibold text-orange-700 mb-2">🥈 Runner-up</h4>
                <div className="space-y-3">
                  {runnerUpTitles.map((title, index) => {
                    const titleData = allTitles.find((t) => t.name === title.title_name);
                    return (
                      <div key={index} className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                        <div className="font-medium">{title.title_name}</div>
                        <div className="text-sm text-gray-600">
                          Your Record: {title.value?.toFixed(1)}{getValueSuffix(title.title_name)}
                        </div>
                        {titleData && (
                          <div className="text-xs text-gray-500 mt-1">
                            Current Holder: {titleData.holder_name} ({titleData.current_value?.toFixed(1)}{getValueSuffix(title.title_name)})
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
