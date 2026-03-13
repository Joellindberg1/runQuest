
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { UserTitleStatus } from './UserTitleStatus';
import { backendApi } from '@/shared/services/backendApi';
import { useAllTitles } from '@/shared/hooks/useTitleQueries';

export const TitleRequirements: React.FC = () => {
  const { data: allTitles = [] } = useAllTitles();

  const { data: eligibility = [], isLoading } = useQuery({
    queryKey: ['titles', 'group-eligibility'],
    queryFn: async () => {
      const res = await backendApi.getTitleGroupEligibility();
      if (!res.success) throw new Error(res.error);
      return res.data ?? [];
    },
    staleTime: 2 * 60 * 1000,
  });

  const uniqueTitles = allTitles;

  return (
    <Card className="bg-sidebar border-2 border-foreground/15">
      <CardHeader>
        <CardTitle>Title Eligibility</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="p-4 bg-background rounded-lg border border-foreground/50 w-fit mx-auto">
            <h4 className="font-semibold mb-2">Title Rules:</h4>
            <ul className="text-sm space-y-1 text-muted-foreground">
              <li>• Each title has a minimum requirement to unlock</li>
              <li>• Once unlocked, you must beat the current holder to claim the title</li>
              <li>• Titles change hands immediately when records are broken</li>
            </ul>
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Loading eligibility...</div>
          ) : eligibility.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {eligibility.map((e: any) => (
                <UserTitleStatus key={e.userId} eligibility={e} titles={uniqueTitles} />
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="text-muted-foreground mb-2">No users to display</div>
              <div className="text-sm text-muted-foreground">Start logging runs to compete for titles!</div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
