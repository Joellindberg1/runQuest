import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { TierBadge } from './TierBadge';
import { MetricLabel } from './MetricLabel';
import { SendChallengeModal, type GroupMember } from './SendChallengeModal';
import { Swords, Zap, ChevronRight, Clock } from 'lucide-react';
import type { ChallengeToken, UserBoost, ChallengeStats, ChallengeTier, Challenge } from '@/types/run';
import type { ProgressEntry } from './OngoingChallengeCard';

const OSWALD = "'Oswald', 'Arial Narrow', Arial, sans-serif";

function isPendingStart(startDate?: string): boolean {
  if (!startDate) return false;
  return new Date(startDate + 'T00:00:00') > new Date();
}

function hoursUntilStart(startDate: string): number {
  return Math.max(0, Math.ceil((new Date(startDate + 'T00:00:00').getTime() - Date.now()) / 3_600_000));
}

const TIER_ORDER: ChallengeTier[] = ['legendary', 'major', 'minor'];

function formatValue(metric: string, value: number): string {
  if (metric === 'km') return `${value.toFixed(1)} km`;
  if (metric === 'runs') return `${value} runs`;
  return `${value} XP`;
}

function daysLeft(endDate: string): number {
  return Math.max(0, Math.ceil((new Date(endDate).getTime() - Date.now()) / 86_400_000));
}

interface ChallengesSidebarProps {
  tokens: ChallengeToken[];
  boosts: UserBoost[];
  stats: ChallengeStats;
  activeChallenge?: Challenge | null;
  activeProgress?: ProgressEntry[];
  currentUserId: string;
  groupMembers: GroupMember[];
  onSendToken?: (tokenId: string, opponentId: string) => void;
  onGoToOngoing?: () => void;
}

export const ChallengesSidebar: React.FC<ChallengesSidebarProps> = ({
  tokens,
  boosts,
  stats,
  activeChallenge,
  activeProgress,
  currentUserId,
  groupMembers,
  onSendToken,
  onGoToOngoing,
}) => {
  const [selectedToken, setSelectedToken] = useState<ChallengeToken | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const total = stats.wins + stats.draws + stats.losses;
  const pts   = total === 0 ? null : (stats.wins + stats.draws * 0.5) / total;

  const opponent = activeChallenge
    ? activeChallenge.challenger_id === currentUserId
      ? { id: activeChallenge.opponent_id,   name: activeChallenge.opponent_name }
      : { id: activeChallenge.challenger_id, name: activeChallenge.challenger_name }
    : null;

  const myProgress  = activeProgress?.find(p => p.user_id === currentUserId);
  const oppProgress = activeProgress?.find(p => p.user_id === opponent?.id);

  const openModal = (token: ChallengeToken) => {
    setSelectedToken(token);
    setModalOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* W/D/L stats */}
      <Card className="bg-sidebar border-2 border-foreground/15">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Swords className="w-4 h-4" />
            My Stats
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { label: 'W', value: stats.wins,   cls: 'text-green-600 dark:text-green-400' },
              { label: 'D', value: stats.draws,  cls: 'text-muted-foreground' },
              { label: 'L', value: stats.losses, cls: 'text-red-500 dark:text-red-400' },
              { label: '%', value: pts !== null ? pts.toFixed(3) : '—', cls: 'text-foreground font-bold' },
            ].map(({ label, value, cls }) => (
              <div key={label} className="space-y-0.5">
                <div className={`text-lg font-bold ${cls}`}>{value}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Active challenge — clickable → go to ongoing */}
      {activeChallenge && opponent ? (
        <button
          onClick={onGoToOngoing}
          className="w-full text-left"
          disabled={!onGoToOngoing}
        >
          <Card className="bg-sidebar border-2 border-primary/30 hover:border-primary/60 transition-colors relative overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Swords className="w-4 h-4 text-primary" />
                Challenge Ongoing
                <ChevronRight className="w-3.5 h-3.5 ml-auto text-muted-foreground" />
              </CardTitle>
            </CardHeader>
            <CardContent className={`pt-0 space-y-2 ${isPendingStart(activeChallenge.start_date) ? 'opacity-40' : ''}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <TierBadge tier={activeChallenge.tier} size="sm" />
                <span className="text-xs text-muted-foreground">
                  vs <span className="font-semibold text-foreground">{opponent.name}</span>
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                <MetricLabel metric={activeChallenge.metric} />
              </div>
              {!isPendingStart(activeChallenge.start_date) && myProgress && oppProgress && (
                <div className="flex items-center justify-between text-sm font-semibold">
                  <span className="text-primary">{formatValue(activeChallenge.metric, myProgress.value)}</span>
                  <span className="text-xs text-muted-foreground font-normal">vs</span>
                  <span>{formatValue(activeChallenge.metric, oppProgress.value)}</span>
                </div>
              )}
              {activeChallenge.end_date && !isPendingStart(activeChallenge.start_date) && (
                <div className="text-xs text-muted-foreground">
                  {daysLeft(activeChallenge.end_date)} days remaining
                </div>
              )}
            </CardContent>
            {isPendingStart(activeChallenge.start_date) && activeChallenge.start_date && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 pointer-events-none">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span style={{ fontFamily: OSWALD }} className="text-sm font-medium tracking-wide text-foreground">
                  Starts in {hoursUntilStart(activeChallenge.start_date)}h
                </span>
              </div>
            )}
          </Card>
        </button>
      ) : (
        <Card className="bg-sidebar border-2 border-foreground/15">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Swords className="w-4 h-4" />
              Challenge Ongoing
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground">No active challenge</p>
          </CardContent>
        </Card>
      )}

      {/* Tokens grouped by tier */}
      <Card className="bg-sidebar border-2 border-foreground/15">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Swords className="w-4 h-4" />
            My Challenges
            {tokens.length > 0 && (
              <span className="ml-auto bg-primary text-primary-foreground text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                {tokens.length}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {tokens.length === 0 ? (
            <p className="text-xs text-muted-foreground py-1">
              No challenges to send. Earn them by leveling up.
            </p>
          ) : (
            <div className="space-y-3">
              {TIER_ORDER.map(tier => {
                const tierTokens = tokens.filter(t => t.tier === tier);
                if (tierTokens.length === 0) return null;
                return (
                  <div key={tier}>
                    <div className="mb-1.5">
                      <TierBadge tier={tier} size="sm" />
                    </div>
                    <div className="space-y-0.5 ml-1">
                      {tierTokens.map(t => (
                        <button
                          key={t.id}
                          onClick={() => openModal(t)}
                          className="w-full text-left text-xs px-2 py-1.5 rounded-md hover:bg-accent transition-colors flex items-center justify-between text-muted-foreground hover:text-foreground"
                        >
                          <MetricLabel metric={t.metric} />
                          <span className="text-muted-foreground/50">{t.duration_days}d →</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active boosts */}
      {boosts.length > 0 && (
        <Card className="bg-sidebar border-2 border-foreground/15">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Active Boosts
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-1.5">
            {boosts.map(b => (
              <div key={b.id} className="flex justify-between text-sm">
                <span className={b.delta >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}>
                  {b.delta >= 0 ? '+' : ''}{b.delta}× multiplier
                </span>
                <span className="text-xs text-muted-foreground">
                  {b.remaining != null ? `${b.remaining}d left` : b.expires_at ? new Date(b.expires_at).toLocaleDateString('en') : ''}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <SendChallengeModal
        token={selectedToken}
        groupMembers={groupMembers}
        currentUserId={currentUserId}
        userHasActiveChallenge={stats.challenge_active}
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSend={onSendToken}
      />
    </div>
  );
};
