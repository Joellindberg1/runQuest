import React from 'react';
import { CalendarDays, CheckCircle, Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface ParticipationWidgetData {
  kind: 'participation';
  title: string;
  startsAt: string;      // ISO string
  endsAt: string;        // ISO string
  rewardXp: number;
  done: boolean;
  scheduled: boolean;    // true = not started yet
}

interface CompetitionWidgetData {
  kind: 'competition';
  title: string;
  endsAt: string;        // ISO string
  myRank: number;
  myValue: number;
  metric: 'km' | 'elevation';
}

export type EventWidgetData = ParticipationWidgetData | CompetitionWidgetData;

function formatCountdown(endsAt: string): string {
  const diff = new Date(endsAt).getTime() - Date.now();
  if (diff <= 0) return 'Closing now';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

function formatOpensIn(startsAt: string): string {
  const diff = new Date(startsAt).getTime() - Date.now();
  if (diff <= 0) return 'Opens now';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 0) return `In ${h}h ${m}m`;
  return `In ${m}m`;
}

function formatDaysLeft(endsAt: string): string {
  const days = Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return 'Closing soon';
  if (days === 1) return '1d left';
  return `${days}d left`;
}

function formatMetricValue(value: number, metric: 'km' | 'elevation'): string {
  if (metric === 'km') return `${value.toFixed(1)} km`;
  return `${value} m`;
}

interface Props {
  data: EventWidgetData;
}

export const EventWidget: React.FC<Props> = ({ data }) => {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate('/events')}
      className="relative w-full px-3 py-2 rounded-lg bg-sidebar border-2 border-foreground/15 text-left overflow-hidden hover:border-primary/40 transition-colors cursor-pointer"
    >
      {data.kind === 'participation' ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <CalendarDays className="w-3.5 h-3.5 text-primary shrink-0" />
              {data.title}
            </div>
            {data.done
              ? <CheckCircle className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--rq-success)' }} />
              : !data.scheduled && <span className="text-xs font-bold shrink-0" style={{ color: 'var(--rq-gold)' }}>+{data.rewardXp} XP</span>
            }
          </div>
          {data.done
            ? <span className="text-xs" style={{ color: 'var(--rq-success)' }}>Done!</span>
            : data.scheduled
            ? (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="w-3 h-3 shrink-0" />
                {formatOpensIn(data.startsAt)}
              </div>
            )
            : (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="w-3 h-3 shrink-0" />
                {formatCountdown(data.endsAt)}
              </div>
            )
          }
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <CalendarDays className="w-3.5 h-3.5 text-primary shrink-0" />
              {data.title}
            </div>
            <span className="text-xs text-muted-foreground shrink-0">{formatDaysLeft(data.endsAt)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span style={{ color: 'var(--rq-gold)' }}>
              #{data.myRank} · {formatMetricValue(data.myValue, data.metric)}
            </span>
          </div>
        </div>
      )}
    </button>
  );
};
