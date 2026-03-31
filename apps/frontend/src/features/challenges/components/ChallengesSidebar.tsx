import React, { useState } from 'react';
import { TierBadge } from './TierBadge';
import { MetricLabel } from './MetricLabel';
import { SendChallengeModal, type GroupMember } from './SendChallengeModal';
import { Swords, Zap, ChevronRight, Clock } from 'lucide-react';
import type { ChallengeToken, UserBoost, ChallengeStats, ChallengeTier, Challenge } from '@runquest/types';
import type { ProgressEntry } from './OngoingChallengeCard';

const bebas = { fontFamily: 'Bebas Neue, sans-serif' };
const barlow = { fontFamily: 'Barlow Condensed, sans-serif' };

const TIER_ORDER: ChallengeTier[] = ['legendary', 'major', 'minor'];

function formatValue(metric: string, value: number): string {
  if (metric === 'km') return `${value.toFixed(1)} km`;
  if (metric === 'runs') return `${value} runs`;
  return `${value} XP`;
}

function formatEndDate(endDate: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(endDate + 'T00:00:00');
  const diff = Math.round((end.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return endDate;
}

function isPendingStart(startDate?: string): boolean {
  if (!startDate) return false;
  return new Date(startDate + 'T00:00:00') > new Date();
}

function hoursUntilStart(startDate: string): number {
  return Math.max(0, Math.ceil((new Date(startDate + 'T00:00:00').getTime() - Date.now()) / 3_600_000));
}

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ icon, title, badge, children }) => (
  <div style={{ background: 'var(--rq-surface-1)', border: '1px solid var(--rq-border-1)' }}>
    <div
      className="flex items-center gap-2 px-3 py-2.5"
      style={{ borderBottom: '1px solid var(--rq-border-1)' }}
    >
      <span style={{ color: 'var(--rq-text-dim)' }}>{icon}</span>
      <span
        className="flex-1 uppercase tracking-widest"
        style={{ ...barlow, fontSize: '0.7rem', fontWeight: 700, color: 'var(--rq-text-muted)', letterSpacing: '0.15em' }}
      >
        {title}
      </span>
      {badge}
    </div>
    <div className="px-3 py-3">{children}</div>
  </div>
);

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

  const activeBoosts = boosts.filter(b => {
    if (b.remaining != null) return b.remaining > 0;
    if (b.expires_at) return new Date(b.expires_at) > new Date();
    return true;
  });

  return (
    <div className="space-y-3">
      {/* W/D/L stats */}
      <Section icon={<Swords className="w-3.5 h-3.5" />} title="My Record">
        <div className="grid grid-cols-4 gap-1.5">
          {[
            { label: 'Wins',   value: String(stats.wins),   color: 'var(--rq-success)' },
            { label: 'Draw',   value: String(stats.draws),  color: 'var(--rq-text-muted)' },
            { label: 'Loss',   value: String(stats.losses), color: 'var(--rq-danger)' },
            { label: 'Pct',    value: pts !== null ? pts.toFixed(3) : '—', color: 'var(--rq-gold)' },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              className="flex flex-col items-center gap-0.5 py-1.5"
              style={{ background: 'var(--rq-surface-2)', border: '1px solid var(--rq-border-1)' }}
            >
              <span style={{ ...bebas, fontSize: '1.3rem', lineHeight: 1, color }}>{value}</span>
              <span style={{ ...barlow, fontSize: '0.6rem', color: 'var(--rq-text-dim)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>{label}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* Active challenge */}
      {activeChallenge && opponent ? (
        <button
          onClick={onGoToOngoing}
          className="w-full text-left"
          disabled={!onGoToOngoing}
          style={{ display: 'block' }}
        >
          <div
            style={{
              background: 'var(--rq-surface-1)',
              border: '1px solid var(--rq-border-1)',
              borderLeft: '3px solid color-mix(in srgb, var(--rq-gold) 60%, transparent)',
              position: 'relative',
              overflow: 'hidden',
            }}
            className="hover:bg-[var(--rq-surface-2)] transition-colors"
          >
            <div
              className="flex items-center gap-2 px-3 py-2.5"
              style={{ borderBottom: '1px solid var(--rq-border-1)' }}
            >
              <Swords className="w-3.5 h-3.5" style={{ color: 'var(--rq-gold)' }} />
              <span
                className="flex-1 uppercase tracking-widest"
                style={{ ...barlow, fontSize: '0.7rem', fontWeight: 700, color: 'var(--rq-text-muted)', letterSpacing: '0.15em' }}
              >
                Live Challenge
              </span>
              <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--rq-text-dim)' }} />
            </div>

            <div className={`px-3 py-3 space-y-2 ${isPendingStart(activeChallenge.start_date) ? 'opacity-40' : ''}`}>
              <div className="flex items-center gap-2">
                <TierBadge tier={activeChallenge.tier} size="sm" />
                <span style={{ ...barlow, fontSize: '0.8rem', color: 'var(--rq-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  vs <span style={{ color: 'var(--rq-text-strong)', fontWeight: 700 }}>{opponent.name}</span>
                </span>
              </div>

              {!isPendingStart(activeChallenge.start_date) && myProgress && oppProgress && (
                <div className="flex items-baseline justify-between gap-2">
                  <span style={{ ...bebas, fontSize: '1.4rem', color: 'var(--rq-gold)', lineHeight: 1 }}>
                    {formatValue(activeChallenge.metric, myProgress.value)}
                  </span>
                  <span style={{ ...barlow, fontSize: '0.7rem', color: 'var(--rq-text-dim)', textTransform: 'uppercase' }}>vs</span>
                  <span style={{ ...bebas, fontSize: '1.4rem', color: 'var(--rq-text-muted)', lineHeight: 1 }}>
                    {formatValue(activeChallenge.metric, oppProgress.value)}
                  </span>
                </div>
              )}

              {activeChallenge.end_date && !isPendingStart(activeChallenge.start_date) && (
                <span style={{ ...barlow, fontSize: '0.72rem', color: 'var(--rq-text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Ends {formatEndDate(activeChallenge.end_date)}
                </span>
              )}
            </div>

            {isPendingStart(activeChallenge.start_date) && activeChallenge.start_date && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 pointer-events-none" style={{ background: 'rgba(0,0,0,0.5)' }}>
                <Clock className="w-4 h-4" style={{ color: 'var(--rq-text-muted)' }} />
                <span style={{ ...bebas, fontSize: '1.1rem', letterSpacing: '0.05em', color: 'var(--rq-text-strong)' }}>
                  Starts in {hoursUntilStart(activeChallenge.start_date)}h
                </span>
              </div>
            )}
          </div>
        </button>
      ) : (
        <Section icon={<Swords className="w-3.5 h-3.5" />} title="Live Challenge">
          <p style={{ ...barlow, fontSize: '0.78rem', color: 'var(--rq-text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>No active challenge</p>
        </Section>
      )}

      {/* Tokens grouped by tier */}
      <div data-tour="challenges-tokens">
      <Section
        icon={<Swords className="w-3.5 h-3.5" />}
        title="My Challenges"
        badge={tokens.length > 0 ? (
          <span
            style={{
              ...bebas,
              fontSize: '0.9rem',
              lineHeight: 1,
              color: 'var(--rq-gold)',
              background: 'var(--rq-gold-mid)',
              border: '1px solid color-mix(in srgb, var(--rq-gold) 30%, transparent)',
              padding: '1px 7px',
            }}
          >
            {tokens.length}
          </span>
        ) : undefined}
      >
        {tokens.length === 0 ? (
          <p style={{ ...barlow, fontSize: '0.78rem', color: 'var(--rq-text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
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
                  <div className="space-y-0.5">
                    {tierTokens.map(t => (
                      <button
                        key={t.id}
                        onClick={() => openModal(t)}
                        className="w-full text-left px-2 py-1.5 hover:bg-[var(--rq-surface-2)] transition-colors flex items-center justify-between"
                        style={{ borderLeft: '1px solid var(--rq-border-1)' }}
                      >
                        <span style={{ ...barlow, fontSize: '0.8rem', color: 'var(--rq-text-soft)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                          <MetricLabel metric={t.metric} />
                        </span>
                        <span style={{ ...barlow, fontSize: '0.72rem', color: 'var(--rq-text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {t.duration_days}d →
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      </div>

      {/* Active boosts */}
      {activeBoosts.length > 0 && (
        <Section icon={<Zap className="w-3.5 h-3.5" />} title="Active Boosts">
          <div className="space-y-1.5">
            {activeBoosts.map(b => (
              <div key={b.id} className="flex justify-between items-baseline">
                <span style={{ ...barlow, fontSize: '0.85rem', fontWeight: 700, color: b.delta >= 0 ? 'var(--rq-success)' : 'var(--rq-danger)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {b.delta >= 0 ? '+' : ''}{b.delta}× multiplier
                </span>
                <span style={{ ...barlow, fontSize: '0.72rem', color: 'var(--rq-text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {b.remaining != null ? `${b.remaining}d` : b.expires_at ? new Date(b.expires_at).toLocaleDateString('en') : ''}
                </span>
              </div>
            ))}
          </div>
        </Section>
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
