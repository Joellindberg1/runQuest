import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Crown } from 'lucide-react';
import { TitleCard } from './title/TitleCard';
import { UserTitleStatus } from './title/UserTitleStatus';
import { backendApi } from '@/shared/services/backendApi';
import type { TitleLeaderboard } from '@/shared/hooks/useTitleQueries';

interface MyTitlesTabProps {
  titles: TitleLeaderboard[];
  currentUserId: string;
}

export const MyTitlesTab: React.FC<MyTitlesTabProps> = ({ titles, currentUserId }) => {
  const { data: eligibility = [] } = useQuery({
    queryKey: ['titles', 'group-eligibility'],
    queryFn: async () => {
      const res = await backendApi.getTitleGroupEligibility();
      if (!res.success) throw new Error(res.error);
      return res.data ?? [];
    },
    staleTime: 2 * 60 * 1000,
  });

  const myTitles = titles.filter(t => t.holder?.user_id === currentUserId);
  const myEligibility = eligibility.find(e => e.userId === currentUserId);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Titles You Hold
        </h3>
        {myTitles.length === 0 ? (
          <div className="text-center py-10">
            <Crown className="w-8 h-8 mx-auto mb-2 text-foreground/20" />
            <p className="text-sm text-muted-foreground">No titles held yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Check the Leaderboard tab to see what it takes to claim one.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {myTitles.map(title => (
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              <TitleCard key={title.id} title={title as any} />
            ))}
          </div>
        )}
      </div>

      {myEligibility && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Your Stats
          </h3>
          <UserTitleStatus eligibility={myEligibility} />
        </div>
      )}
    </div>
  );
};
