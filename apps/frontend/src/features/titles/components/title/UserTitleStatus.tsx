
import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
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

interface SectionProps {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  count: number;
}

const Section: React.FC<SectionProps> = ({ label, defaultOpen = true, children, count }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-2">
      <button
        className="w-full flex items-center justify-between px-2 py-1.5 rounded-md bg-muted/50 hover:bg-muted transition-colors mb-1"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-xs font-semibold">{label}</span>
        <span className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{count}</span>
          {open
            ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
        </span>
      </button>
      {open && <div className="space-y-1 px-1">{children}</div>}
    </div>
  );
};

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
        <Section label="Eligible" defaultOpen={true} count={eligible.length}>
          {eligible.map(t => renderRow(t, true))}
        </Section>
      )}
      {notEligible.length > 0 && (
        <Section label="Not Eligible" defaultOpen={false} count={notEligible.length}>
          {notEligible.map(t => renderRow(t, false))}
        </Section>
      )}
    </div>
  );
};
