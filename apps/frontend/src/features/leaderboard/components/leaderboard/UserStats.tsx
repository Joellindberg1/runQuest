
import React from 'react';
import type { User } from '@runquest/types';

interface UserStatsProps {
  user: User;
  stats: {
    numberOfRuns: number;
    longestRun: number;
    averageKmPerRun: number;
    avgXpPer14Days: number;
    daysToNextLevel: number;
    latestRun?: { date: string; distance: number } | null;
  };
}

const bebas = { fontFamily: 'Bebas Neue, sans-serif' };
const barlow = { fontFamily: 'Barlow Condensed, sans-serif' };
const mono = { fontFamily: 'Share Tech Mono, monospace' };

const Block: React.FC<{ value: string; label: string; hero?: boolean }> = ({ value, label, hero }) => (
  <div
    className="flex flex-col gap-0.5 px-2 py-2"
    style={{ background: 'var(--rq-surface-2)', border: '1px solid var(--rq-border-2)' }}
  >
    <span
      className="leading-none"
      style={{
        ...bebas,
        fontSize: hero ? '1.5rem' : '1.15rem',
        color: hero ? 'var(--rq-gold)' : 'hsl(var(--foreground))',
      }}
    >
      {value}
    </span>
    <span
      className="leading-none uppercase tracking-wide"
      style={{ ...barlow, fontSize: '0.7rem', color: 'var(--rq-text-soft)' }}
    >
      {label}
    </span>
  </div>
);

export const UserStats: React.FC<UserStatsProps> = ({ user, stats }) => {
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-3 gap-1.5">
        <Block value={`${user.total_km.toFixed(0)} km`} label="Total" hero />
        <Block value={`${stats.longestRun.toFixed(1)} km`} label="Longest" />
        <Block value={String(stats.numberOfRuns)} label="Runs" />
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <Block value={`${stats.averageKmPerRun.toFixed(1)} km`} label="Avg run" />
        <Block value={`${user.current_streak}d`} label="Streak" />
        <Block value={`${user.longest_streak}d`} label="Best" />
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <Block value={user.total_xp.toLocaleString()} label="XP total" hero />
        <Block value={`${stats.avgXpPer14Days}/d`} label="14D XP Avg" />
        <Block
          value={stats.daysToNextLevel > 0 ? `${stats.daysToNextLevel}d` : 'MAX'}
          label="Next lvl"
          hero
        />
      </div>

      {stats.latestRun && (
        <div
          className="flex items-center justify-between px-2 py-1.5"
          style={{ background: 'var(--rq-surface-1)', border: '1px solid var(--rq-border-1)' }}
        >
          <span style={{ ...barlow, fontSize: '0.7rem', color: 'var(--rq-text-soft)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Last run
          </span>
          <span style={{ ...mono, fontSize: '0.75rem', color: 'var(--rq-text-soft)' }}>
            {new Date(stats.latestRun.date).toLocaleDateString()} · {stats.latestRun.distance.toFixed(1)} km
          </span>
        </div>
      )}
    </div>
  );
};
