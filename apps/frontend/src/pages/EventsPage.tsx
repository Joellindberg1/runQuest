import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Button } from '@/shared/components/ui/button';
import {
  CalendarDays, Trophy, Clock, CheckCircle, ChevronDown, ChevronRight,
  ChevronLeft, Loader2,
} from 'lucide-react';
import { Badge } from '@/shared/components/ui/badge';
import { AppLayout } from '@/components/layout/AppLayout';
import { useGroupName } from '@/shared/hooks/useGroupName';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/providers/AuthProvider';
import { backendApi } from '@/shared/services/backendApi';

// ── Types ─────────────────────────────────────────────────────────────────────

type ApiEvent = Awaited<ReturnType<typeof backendApi.getEvents>>['data'] extends { events: (infer E)[] } ? E : never;

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCountdown(endsAt: string): string {
  const diff = new Date(endsAt).getTime() - Date.now();
  if (diff <= 0) return 'Stänger nu';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m kvar`;
  return `${m}m kvar`;
}

function formatOpensIn(startsAt: string): string {
  const diff = new Date(startsAt).getTime() - Date.now();
  if (diff <= 0) return 'Öppnar nu';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 0) return `Öppnar om ${h}h ${m}m`;
  return `Öppnar om ${m}m`;
}

function formatCompetitionEnd(endsAt: string): string {
  const end = new Date(endsAt);
  const days = Math.ceil((end.getTime() - Date.now()) / 86_400_000);
  const daysStr = days <= 0 ? 'Stänger snart' : days === 1 ? '1d kvar' : `${days}d kvar`;
  const y = end.getFullYear();
  const mo = String(end.getMonth() + 1).padStart(2, '0');
  const d = String(end.getDate()).padStart(2, '0');
  const hh = String(end.getHours()).padStart(2, '0');
  const mm = String(end.getMinutes()).padStart(2, '0');
  return `${daysStr} — Ends ${y}-${mo}-${d} ${hh}:${mm}`;
}

function formatMetric(value: number, metric: string | null): string {
  return metric === 'km' ? `${value.toFixed(1)} km` : `${Math.round(value)} m`;
}

function formatDateRange(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const fmt = (d: Date) => d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
  return `${fmt(start)}–${fmt(end)}`;
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

const SectionHeader: React.FC<{ icon: React.ReactNode; title: string }> = ({ icon, title }) => (
  <div className="flex items-center gap-2 px-1">
    <span className="text-muted-foreground">{icon}</span>
    <span
      className="text-muted-foreground"
      style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '0.75rem', letterSpacing: '0.18em', textTransform: 'uppercase' }}
    >
      {title}
    </span>
    <div className="flex-1 h-px bg-foreground/10" />
  </div>
);

const EmptyState: React.FC<{ message: string }> = ({ message }) => (
  <Card className="bg-sidebar border border-dashed border-foreground/15">
    <CardContent className="py-5 text-center text-sm text-muted-foreground">
      {message}
    </CardContent>
  </Card>
);

// ── Participation Card ────────────────────────────────────────────────────────

const ParticipationCard: React.FC<{ event: ApiEvent }> = ({ event }) => {
  const done = !!event.myEntry?.qualified;
  const scheduled = event.status === 'scheduled';
  const [timeLabel, setTimeLabel] = useState(() =>
    scheduled ? formatOpensIn(event.startsAt) : formatCountdown(event.endsAt)
  );

  useEffect(() => {
    const update = () => setTimeLabel(
      scheduled ? formatOpensIn(event.startsAt) : formatCountdown(event.endsAt)
    );
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [event.startsAt, event.endsAt, scheduled]);

  const borderStyle = done
    ? 'border-[color:var(--rq-success)]/40'
    : scheduled
    ? 'border-foreground/15'
    : 'border-[color:var(--rq-gold)]/40';

  return (
    <Card className={`bg-sidebar border-2 ${borderStyle}`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span style={{ color: done ? 'var(--rq-success)' : 'var(--rq-gold)' }}>
              <CalendarDays className="w-5 h-5" />
            </span>
            <div>
              <div className="text-base font-bold tracking-wide">{event.template.name}</div>
              <div className="text-xs text-muted-foreground font-normal">Participation · {event.template.description}</div>
            </div>
          </div>
          <Badge variant="outline" className="font-bold text-sm shrink-0"
            style={{ color: 'var(--rq-gold)', borderColor: 'rgba(201,168,76,0.4)' }}>
            +{event.template.rewardXp} XP
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {event.template.minKm > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full border border-foreground/15 text-muted-foreground"
              style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              min {event.template.minKm} km
            </span>
          )}
          {(event.template.requiresWeather ?? []).map(w => (
            <span key={w} className="text-xs px-2 py-0.5 rounded-full border border-foreground/15 text-muted-foreground"
              style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {w}
            </span>
          ))}
        </div>

        {scheduled && (
          <div className="flex items-center justify-between rounded-lg px-4 py-3 border border-foreground/15 bg-background">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="w-4 h-4 shrink-0" />
              <span>Kommer snart</span>
            </div>
            <span className="font-semibold text-sm text-muted-foreground">{timeLabel}</span>
          </div>
        )}

        {!done && !scheduled && (
          <>
            <div className="flex items-center justify-between rounded-lg px-4 py-3 border border-foreground/15 bg-background">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="w-4 h-4 shrink-0" />
                <span>Fönster stänger</span>
              </div>
              <span className="font-semibold text-sm" style={{ color: 'var(--rq-gold)' }}>{timeLabel}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg px-4 py-3 border"
              style={{ background: 'rgba(201,168,76,0.07)', borderColor: 'rgba(201,168,76,0.25)' }}>
              <span className="text-sm" style={{ color: 'var(--rq-gold)' }}>
                Logga ett pass ≥ {event.template.minKm} km
              </span>
              <ChevronRight className="w-4 h-4" style={{ color: 'var(--rq-gold)' }} />
            </div>
          </>
        )}

        {done && (
          <div className="flex items-center gap-2.5 rounded-lg px-4 py-3 border"
            style={{ background: 'rgba(76,175,114,0.08)', borderColor: 'rgba(76,175,114,0.3)' }}>
            <CheckCircle className="w-4 h-4 shrink-0" style={{ color: 'var(--rq-success)' }} />
            <span className="text-sm font-medium" style={{ color: 'var(--rq-success)' }}>
              Klar! +{event.myEntry!.xpAwarded} XP intjänat
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// ── Competition Card ──────────────────────────────────────────────────────────

const CompetitionCard: React.FC<{ event: ApiEvent }> = ({ event }) => {
  const leaderboard = event.leaderboard ?? [];
  const { rewardXp1st, rewardXp2nd, rewardXp3rd } = event.template;

  const xpForRank = (rank: number) => {
    if (rank === 1) return rewardXp1st;
    if (rank === 2) return rewardXp2nd;
    if (rank === 3) return rewardXp3rd;
    return 0;
  };

  return (
    <Card className="bg-sidebar border-2 border-foreground/15">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span style={{ color: 'var(--rq-gold)' }}><Trophy className="w-5 h-5" /></span>
            <div>
              <div className="text-base font-bold tracking-wide">{event.template.name}</div>
              <div className="text-xs text-muted-foreground font-normal">Competition · {event.metric === 'km' ? 'Total distans' : 'Total höjdmeter'}</div>
            </div>
          </div>
          <span className="text-xs text-muted-foreground text-right leading-tight shrink-0">
            {formatCompetitionEnd(event.endsAt)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {leaderboard.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-2">Inga deltagare ännu</p>
        ) : (
          <div className="rounded-lg border border-foreground/10 overflow-hidden">
            {leaderboard.map(entry => (
              <div key={entry.userId}
                className="flex items-center gap-3 px-4 py-2.5 border-b border-foreground/8 last:border-0"
                style={entry.isMe ? { background: 'rgba(201,168,76,0.07)' } : undefined}>
                <span className="w-5 text-sm font-bold shrink-0"
                  style={{
                    fontFamily: 'Barlow Condensed, sans-serif',
                    color: entry.rank === 1 ? 'var(--rq-gold)' : entry.rank === 2 ? '#aaa' : entry.rank === 3 ? '#c87533' : 'var(--rq-text-soft)',
                  }}>
                  #{entry.rank}
                </span>
                <span className="flex-1 text-sm"
                  style={{ color: entry.isMe ? 'var(--rq-gold)' : undefined, fontWeight: entry.isMe ? 600 : undefined }}>
                  {entry.isMe ? '▶ Du' : entry.userName}
                </span>
                <span className="text-xs tabular-nums"
                  style={{ color: entry.isMe ? 'var(--rq-gold)' : 'var(--rq-text-soft)' }}>
                  {formatMetric(entry.totalValue, event.metric)}
                </span>
                <span className="w-14 text-right">
                  {xpForRank(entry.rank) > 0
                    ? <span className="text-xs px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(201,168,76,0.1)', color: 'var(--rq-gold)', border: '1px solid rgba(201,168,76,0.2)' }}>
                        {xpForRank(entry.rank)} XP
                      </span>
                    : <span className="text-xs text-muted-foreground/40">—</span>
                  }
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>XP-pris:</span>
          <span className="flex items-center gap-1">🥇 <span style={{ color: 'var(--rq-gold)' }}>{rewardXp1st}</span></span>
          <span className="flex items-center gap-1">🥈 <span style={{ color: '#aaa' }}>{rewardXp2nd}</span></span>
          <span className="flex items-center gap-1">🥉 <span style={{ color: '#c87533' }}>{rewardXp3rd}</span></span>
        </div>
      </CardContent>
    </Card>
  );
};

// ── History ───────────────────────────────────────────────────────────────────

const HISTORY_PER_PAGE = 5;

type HistoryEvent = Awaited<ReturnType<typeof backendApi.getEventsHistory>>['data'] extends { events: (infer E)[] } ? E : never;

const HistorySection: React.FC<{ items: HistoryEvent[] }> = ({ items }) => {
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const totalPages = Math.ceil(items.length / HISTORY_PER_PAGE);
  const pageItems = items.slice(page * HISTORY_PER_PAGE, (page + 1) * HISTORY_PER_PAGE);

  return (
    <div className="space-y-2">
      {pageItems.map(item => {
        const isOpen = expanded === item.id;
        const qualified = !!item.myEntry?.qualified;
        const rank = item.myEntry?.rank;

        const resultLabel =
          item.type === 'participation'
            ? qualified ? '✓ Klar' : 'Missad'
            : rank != null ? `#${rank}` : '—';

        const resultColor =
          item.type === 'participation'
            ? qualified ? 'var(--rq-success)' : 'var(--rq-danger)'
            : rank != null && rank <= 3 ? 'var(--rq-gold)' : 'var(--rq-text-soft)';

        const xp = item.myEntry?.xpAwarded ?? 0;

        return (
          <Card key={item.id} className="bg-sidebar border border-foreground/12 overflow-hidden">
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent transition-colors"
              onClick={() => setExpanded(prev => prev === item.id ? null : item.id)}
            >
              <span className="text-muted-foreground shrink-0">
                {item.type === 'competition'
                  ? <Trophy className="w-4 h-4" />
                  : <CalendarDays className="w-4 h-4" />
                }
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{item.template.name}</div>
                <div className="text-xs text-muted-foreground">{formatDateRange(item.startsAt, item.endsAt)}</div>
              </div>
              <span className="text-sm font-medium shrink-0" style={{ color: resultColor }}>
                {resultLabel}
              </span>
              <span className="text-sm shrink-0 w-12 text-right"
                style={{ color: xp > 0 ? 'var(--rq-gold)' : 'var(--rq-text-soft)' }}>
                {xp > 0 ? `+${xp}` : '—'}
              </span>
              {isOpen
                ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              }
            </div>

            {isOpen && (
              <div className="px-4 pb-4 border-t border-foreground/8">
                {/* Regler */}
                <div className="flex flex-wrap gap-2 pt-3 pb-2">
                  {item.template.minKm > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full border border-foreground/15 text-muted-foreground"
                      style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                      min {item.template.minKm} km
                    </span>
                  )}
                  {item.type === 'participation' && item.template.rewardXp > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full border border-foreground/15 text-muted-foreground"
                      style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                      +{item.template.rewardXp} XP
                    </span>
                  )}
                  {item.type === 'competition' && (
                    <span className="text-xs px-2 py-0.5 rounded-full border border-foreground/15 text-muted-foreground"
                      style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                      🥇{item.template.rewardXp1st} 🥈{item.template.rewardXp2nd} 🥉{item.template.rewardXp3rd} XP
                    </span>
                  )}
                </div>
              </div>
            )}
            {isOpen && item.leaderboard.length > 0 && (
              <div className="px-4 pb-4">
                <div className="rounded-lg border border-foreground/10 overflow-hidden mt-3">
                  {item.leaderboard.map(entry => (
                    <div key={entry.userId}
                      className="flex items-center gap-3 px-3 py-2 border-b border-foreground/8 last:border-0 text-sm"
                      style={entry.isMe ? { background: 'rgba(201,168,76,0.07)' } : undefined}>

                      {/* Rank (competition) eller check/kryss (participation) */}
                      {item.type === 'competition' ? (
                        <span className="w-5 text-xs font-bold shrink-0"
                          style={{
                            fontFamily: 'Barlow Condensed, sans-serif',
                            color: entry.rank === 1 ? 'var(--rq-gold)' : entry.rank === 2 ? '#aaa' : entry.rank === 3 ? '#c87533' : 'var(--rq-text-soft)',
                          }}>
                          #{entry.rank}
                        </span>
                      ) : (
                        <span className="w-5 shrink-0 flex items-center">
                          {entry.qualified
                            ? <CheckCircle className="w-3.5 h-3.5" style={{ color: 'var(--rq-success)' }} />
                            : <span className="text-xs text-muted-foreground/50">✕</span>
                          }
                        </span>
                      )}

                      <span className="flex-1"
                        style={{ color: entry.isMe ? 'var(--rq-gold)' : undefined, fontWeight: entry.isMe ? 600 : undefined }}>
                        {entry.isMe ? '▶ Du' : entry.userName}
                      </span>

                      {item.type === 'competition' && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {formatMetric(entry.totalValue, item.metric)}
                        </span>
                      )}

                      {entry.xpAwarded > 0 && (
                        <span className="text-xs" style={{ color: 'var(--rq-gold)' }}>+{entry.xpAwarded} XP</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        );
      })}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <Button variant="ghost" size="sm"
            onClick={() => { setPage(p => p - 1); setExpanded(null); }}
            disabled={page === 0}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm text-muted-foreground">{page + 1} / {totalPages}</span>
          <Button variant="ghost" size="sm"
            onClick={() => { setPage(p => p + 1); setExpanded(null); }}
            disabled={page >= totalPages - 1}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
};

// ── Page ──────────────────────────────────────────────────────────────────────

const EventsPage: React.FC = () => {
  const groupName = useGroupName();
  const { user } = useAuth();

  const { data: eventsData, isLoading } = useQuery({
    queryKey: ['events'],
    queryFn: async () => {
      const res = await backendApi.getEvents();
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    enabled: !!user,
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });

  const { data: historyData } = useQuery({
    queryKey: ['events', 'history'],
    queryFn: async () => {
      const res = await backendApi.getEventsHistory();
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const activeEvents = eventsData?.events ?? [];
  const participationEvents = activeEvents.filter(e => e.type === 'participation');
  const competitionEvents = activeEvents.filter(e => e.type === 'competition');
  const historyItems = historyData?.events ?? [];

  return (
    <AppLayout groupName={groupName}>
      <div className="pt-4 md:pt-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">

            {/* Left column — active events */}
            <div className="space-y-6">
              <div className="space-y-3">
                <SectionHeader icon={<CalendarDays className="w-3.5 h-3.5" />} title="Participation" />
                {participationEvents.length > 0
                  ? participationEvents.map(e => <ParticipationCard key={e.id} event={e} />)
                  : <EmptyState message="Inga aktiva participation events just nu" />
                }
              </div>

              <div className="space-y-3">
                <SectionHeader icon={<Trophy className="w-3.5 h-3.5" />} title="Competition" />
                {competitionEvents.length > 0
                  ? competitionEvents.map(e => <CompetitionCard key={e.id} event={e} />)
                  : <EmptyState message="Inga aktiva tävlingar just nu" />
                }
              </div>
            </div>

            {/* Right column — history */}
            <div className="space-y-3 lg:sticky lg:top-4">
              <SectionHeader icon={<ChevronRight className="w-3.5 h-3.5" />} title="History" />
              {historyItems.length > 0
                ? <HistorySection items={historyItems} />
                : <EmptyState message="Ingen historik ännu" />
              }
            </div>

          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default EventsPage;
