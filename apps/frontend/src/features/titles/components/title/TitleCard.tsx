
import React from 'react';
import { Badge } from '@/shared/components/ui/badge';
import { Crown } from 'lucide-react';
import { getTitleIcon, formatTitleValue, resolveGenderedTitle, Title } from './titleSystemUtils';

interface TitleCardProps {
  title: Title;
}

export const TitleCard: React.FC<TitleCardProps> = ({ title }) => {
  const holder = title.holder || (title.current_holder_id ? {
    user_id: title.current_holder_id,
    user_name: title.holder_name || '',
    value: title.current_value || 0
  } : null);

  const holderValueStr = holder
    ? formatTitleValue(title.metric_key, holder.value ?? 0)
    : null;

  return (
    <div className="p-4 border border-foreground/50 rounded-lg bg-background">
      <div className="flex items-start gap-3">
        {getTitleIcon(title.name)}
        <div className="flex-1">
          <h3 className="font-semibold text-lg mb-1">{resolveGenderedTitle(title.name, (title as any).holder?.user_gender)}</h3>
          <p className="text-sm text-muted-foreground mb-3">{title.description}</p>

          {holder ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="default" className="bg-yellow-600">
                  <Crown className="w-3 h-3 mr-1" />
                  {holder.user_name}
                </Badge>
                <span className="text-sm font-semibold">{holderValueStr}</span>
              </div>

              {(title as any).runners_up && (title as any).runners_up.length > 0 && (
                <div className="mt-3 border-t pt-2">
                  <div className="text-xs font-semibold text-foreground mb-2">Runners Up:</div>
                  <div className="space-y-1">
                    {(title as any).runners_up.slice(0, 3).map((runner: any, index: number) => (
                      <div key={runner.user_id} className="flex justify-between text-xs">
                        <span className="text-muted-foreground">#{index + 2} {runner.user_name}</span>
                        <span className="font-medium">{formatTitleValue(title.metric_key, runner.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Badge variant="outline" className="text-red-600 border-red-200">
                No Current Holder
              </Badge>
              <div className="text-xs text-muted-foreground">
                {formatTitleValue(title.metric_key, title.unlock_requirement)} required to unlock
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
