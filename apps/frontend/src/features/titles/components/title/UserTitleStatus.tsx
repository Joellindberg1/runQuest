
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

const Section: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="mb-2">
    <div className="text-xs font-semibold px-1 mb-1 text-muted-foreground uppercase tracking-wide">{label}</div>
    <div className="space-y-1 px-1">{children}</div>
  </div>
);

export const UserTitleStatus: React.FC<UserTitleStatusProps> = ({ eligibility, titles }) => {
  const { name, gender, values } = eligibility;

  const eligible = titles.filter(t => (values[t.metric_key ?? ''] ?? 0) >= t.unlock_requirement);
  const notEligible = titles.filter(t => (values[t.metric_key ?? ''] ?? 0) < t.unlock_requirement);

  const renderRow = (title: TitleRef, isEligible: boolean) => {
    const key = title.metric_key ?? '';
    const value = values[key] ?? 0;
    return (
      <div key={title.id} className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground truncate">{resolveGenderedTitle(title.name, gender)}</span>
        <span className={`font-medium shrink-0 ${isEligible ? 'text-green-500' : 'text-muted-foreground/60'}`}>
          {isEligible ? '✅' : '❌'} {formatTitleValue(key, value)}
        </span>
      </div>
    );
  };

  return (
    <div className="p-3 border border-foreground/50 rounded-lg bg-background">
      <div className="font-semibold mb-2 text-sm">{name}</div>
      {eligible.length > 0 && (
        <Section label="Eligible">
          {eligible.map(t => renderRow(t, true))}
        </Section>
      )}
      {notEligible.length > 0 && (
        <Section label="Not Eligible">
          {notEligible.map(t => renderRow(t, false))}
        </Section>
      )}
    </div>
  );
};
