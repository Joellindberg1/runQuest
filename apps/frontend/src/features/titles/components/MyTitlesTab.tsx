import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Crown, Check, Save } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { UserTitleStatus } from './title/UserTitleStatus';
import { getTitleIcon, getValueSuffix } from './title/titleSystemUtils';
import { backendApi } from '@/shared/services/backendApi';
import { useUpdateDisplayedTitles } from '@/shared/hooks/useTitleQueries';
import { useToast } from '@/shared/components/ui/use-toast';
import type { TitleLeaderboard } from '@/shared/hooks/useTitleQueries';
import type { User } from '@runquest/types';

interface MyTitlesTabProps {
  titles: TitleLeaderboard[];
  currentUser: User;
  onRefresh?: () => void;
}

/** Mirrors the leaderboard formatTitlesDisplay logic for the preview. */
function formatPreview(names: string[]): string {
  if (names.length === 0) return 'No titles selected';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `The one who is a bit too tryhard, ${names[0]} & ${names[1]}`;
  const last = names[names.length - 1];
  return `The one with too many names, ${names.slice(0, -1).join(', ')} & ${last}`;
}

export const MyTitlesTab: React.FC<MyTitlesTabProps> = ({ titles, currentUser, onRefresh }) => {
  const { data: eligibility = [] } = useQuery({
    queryKey: ['titles', 'group-eligibility'],
    queryFn: async () => {
      const res = await backendApi.getTitleGroupEligibility();
      if (!res.success) throw new Error(res.error);
      return res.data ?? [];
    },
    staleTime: 2 * 60 * 1000,
  });

  const updateDisplayed = useUpdateDisplayedTitles();
  const { toast } = useToast();

  const myTitles = titles.filter(t => t.holder?.user_id === currentUser.id);
  const myEligibility = eligibility.find(e => e.userId === currentUser.id);

  // Initialise selection from the user's saved displayed_title_ids
  const [selected, setSelected] = useState<string[]>(currentUser.displayed_title_ids ?? []);
  const [dirty, setDirty] = useState(false);

  // Sync when user data changes (e.g. after save invalidates cache)
  useEffect(() => {
    setSelected(currentUser.displayed_title_ids ?? []);
    setDirty(false);
  }, [currentUser.displayed_title_ids]);

  const toggle = (titleId: string) => {
    setSelected(prev => {
      const next = prev.includes(titleId)
        ? prev.filter(id => id !== titleId)
        : prev.length < 3
          ? [...prev, titleId]
          : prev; // already at 3, ignore
      setDirty(true);
      return next;
    });
  };

  const handleSave = async () => {
    const res = await updateDisplayed.mutateAsync(selected);
    if (res.success) {
      toast({ title: 'Saved', description: 'Your title display has been updated.' });
      setDirty(false);
      onRefresh?.();
    } else {
      toast({ title: 'Error', description: 'Could not save. Try again.', variant: 'destructive' });
    }
  };

  const selectedNames = selected
    .map(id => myTitles.find(t => t.id === id)?.name)
    .filter(Boolean) as string[];

  return (
    <div className="space-y-6">

      {/* Title builder */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Choose Display (max 3)
          </h3>
          <span className="text-xs text-muted-foreground">{selected.length}/3 selected</span>
        </div>

        {myTitles.length === 0 ? (
          <div className="text-center py-10">
            <Crown className="w-8 h-8 mx-auto mb-2 text-foreground/20" />
            <p className="text-sm text-muted-foreground">No titles held yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Check the Leaderboard tab to see what it takes to claim one.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {myTitles.map(title => {
              const pos = selected.indexOf(title.id);
              const isSelected = pos !== -1;
              const atMax = selected.length >= 3;

              return (
                <button
                  key={title.id}
                  onClick={() => toggle(title.id)}
                  disabled={!isSelected && atMax}
                  className={`w-full text-left p-3 rounded-lg border-2 transition-colors flex items-center gap-3
                    ${isSelected
                      ? 'border-primary/50 bg-primary/5'
                      : atMax
                        ? 'border-foreground/10 bg-sidebar opacity-40 cursor-not-allowed'
                        : 'border-foreground/15 bg-sidebar hover:border-foreground/30'
                    }`}
                >
                  {/* Order badge */}
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold
                    ${isSelected ? 'bg-primary text-primary-foreground' : 'bg-foreground/10 text-foreground/40'}`}>
                    {isSelected ? pos + 1 : <Check className="w-3 h-3 opacity-0" />}
                  </div>

                  {/* Icon */}
                  <div className="shrink-0">{getTitleIcon(title.name)}</div>

                  {/* Name + value */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold leading-tight">{title.name}</p>
                    {title.holder && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {title.holder.value.toFixed(1)}{getValueSuffix(title.name)}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Preview + save */}
        {myTitles.length > 0 && (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg bg-sidebar border border-foreground/10 px-4 py-3">
              <p className="text-xs text-muted-foreground mb-1">Preview on leaderboard:</p>
              <p className="text-sm italic text-foreground/80">{formatPreview(selectedNames)}</p>
            </div>
            <Button
              size="sm"
              className="w-full"
              onClick={handleSave}
              disabled={!dirty || updateDisplayed.isPending}
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {updateDisplayed.isPending ? 'Saving…' : 'Save display'}
            </Button>
          </div>
        )}
      </div>

      {/* Eligibility stats */}
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
