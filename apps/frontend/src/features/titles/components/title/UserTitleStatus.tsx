
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

  const eligible = titles.filter(t => (values[t.metric_key ?? ''] ?? 0) >= t.unlock_requirement);
  const notEligible = titles.filter(t => (values[t.metric_key ?? ''] ?? 0) < t.unlock_requirement);

  const renderRow = (title: TitleRef, isEligible: boolean) => {
    const key = title.metric_key ?? '';
    const value = values[key] ?? 0;
    return (
      <div key={title.id} className="flex items-center justify-between gap-1 text-xs">
        <span className="text-foreground/80 truncate">{resolveGenderedTitle(title.name, gender)}</span>
        <span className="font-medium shrink-0 text-foreground/60">{formatTitleValue(key, value)}</span>
      </div>
    );
  };

  return (
    <div className="p-3 border border-foreground/50 rounded-lg bg-background">
      <div className="font-semibold mb-3 text-sm">{name}</div>
      <div className="grid grid-cols-2 gap-3">
        {eligible.length > 0 && (
          <div>
            <div className="flex items-center justify-between px-2 py-1.5 rounded-md bg-sidebar border border-foreground/15 mb-1.5">
              <span className="text-sm font-bold" style={{ color: 'var(--rq-success)' }}>Eligible</span>
              <span className="text-xs text-muted-foreground">{eligible.length}</span>
            </div>
            <div className="space-y-1">{eligible.map(t => renderRow(t, true))}</div>
          </div>
        )}
        {notEligible.length > 0 && (
          <div>
            <div className="flex items-center justify-between px-2 py-1.5 rounded-md bg-sidebar border border-foreground/15 mb-1.5">
              <span className="text-sm font-bold text-destructive">Not Eligible</span>
              <span className="text-xs text-muted-foreground">{notEligible.length}</span>
            </div>
            <div className="space-y-1">{notEligible.map(t => renderRow(t, false))}</div>
          </div>
        )}
      </div>
    </div>
  );
};
