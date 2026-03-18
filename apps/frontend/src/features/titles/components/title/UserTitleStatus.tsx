
import React from 'react';
import { formatTitleValue, resolveGenderedTitle } from './titleSystemUtils';

export interface UserEligibility {
  userId: string;
  name: string;
  gender?: string | null;
  values: Record<string, number>;
}

interface TitleRef {
  id: string;
  name: string;
  metric_key?: string;
  unlock_requirement: number;
}

interface UserTitleStatusProps {
  eligibility: UserEligibility;
  titles: TitleRef[];
}

export const UserTitleStatus: React.FC<UserTitleStatusProps> = ({ eligibility, titles }) => {
  const { name, gender, values } = eligibility;

  return (
    <div className="p-3 border border-foreground/50 rounded-lg bg-background">
      <div className="font-semibold mb-2">{name}</div>
      <div className="text-sm space-y-1">
        {titles.map(title => {
          const key = title.metric_key ?? '';
          const value = values[key] ?? 0;
          const eligible = value >= title.unlock_requirement;
          return (
            <div key={title.id} className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground truncate">{resolveGenderedTitle(title.name, gender)}</span>
              <span className={`font-medium shrink-0 ${eligible ? 'text-green-500' : 'text-muted-foreground/60'}`}>
                {eligible ? '✅' : '❌'} {formatTitleValue(key, value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
