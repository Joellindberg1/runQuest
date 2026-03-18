
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
    <div className="p-3 border border-foreground/20 rounded-lg bg-background">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0 [&>svg]:w-5 [&>svg]:h-5">{getTitleIcon(title.name)}</div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm leading-tight mb-0.5 truncate">
            {resolveGenderedTitle(title.name, (title as any).holder?.user_gender)}
          </h3>
          <p className="text-xs text-muted-foreground mb-2 line-clamp-1">{title.description}</p>

          {holder ? (
            <div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge variant="default" className="bg-yellow-600 text-xs px-1.5 py-0 h-5">
                  <Crown className="w-2.5 h-2.5 mr-0.5" />
                  {holder.user_name}
                </Badge>
                <span className="text-xs font-semibold">{holderValueStr}</span>
              </div>

              {(title as any).runners_up && (title as any).runners_up.length > 0 && (
                <div className="mt-1.5 border-t pt-1.5">
                  <div className="space-y-0.5">
                    {(title as any).runners_up.slice(0, 3).map((runner: any, index: number) => (
                      <div key={runner.user_id} className="flex justify-between text-xs">
                        <span className="text-muted-foreground truncate">#{index + 2} {runner.user_name}</span>
                        <span className="font-medium ml-1 shrink-0">{formatTitleValue(title.metric_key, runner.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <Badge variant="outline" className="text-red-600 border-red-200 text-xs px-1.5 py-0 h-5">
                No Holder
              </Badge>
              <div className="text-xs text-muted-foreground mt-1">
                {formatTitleValue(title.metric_key, title.unlock_requirement)} to unlock
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
