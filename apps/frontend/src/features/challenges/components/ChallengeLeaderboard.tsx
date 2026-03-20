import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Trophy } from 'lucide-react';

export interface LeaderboardEntry {
  user_id: string;
  name: string;
  wins: number;
  draws: number;
  losses: number;
}

interface ChallengeLeaderboardProps {
  entries: LeaderboardEntry[];
  currentUserId: string;
}

function calcPts(e: LeaderboardEntry): number {
  const total = e.wins + e.draws + e.losses;
  if (total === 0) return -1; // sort unplayed to bottom
  return (e.wins + e.draws * 0.5) / total;
}

export const ChallengeLeaderboard: React.FC<ChallengeLeaderboardProps> = ({ entries, currentUserId }) => {
  const sorted = [...entries].sort((a, b) => {
    const pd = calcPts(b) - calcPts(a);
    if (pd !== 0) return pd;
    return b.wins - a.wins;
  });

  return (
    <Card className="bg-sidebar border-2 border-foreground/15">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="w-4 h-4" />
          Challenge Leaderboard
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid grid-cols-[2rem_1fr_2.5rem_2.5rem_2.5rem_3.5rem] gap-x-2 px-4 pb-2 text-xs text-muted-foreground font-semibold uppercase tracking-wide">
          <span>#</span>
          <span>Player</span>
          <span className="text-center">W</span>
          <span className="text-center">D</span>
          <span className="text-center">L</span>
          <span className="text-center">%</span>
        </div>
        <div className="divide-y divide-foreground/10">
          {sorted.map((entry, idx) => {
            const isMe = entry.user_id === currentUserId;
            const total = entry.wins + entry.draws + entry.losses;
            const pts = calcPts(entry);
            return (
              <div
                key={entry.user_id}
                className={`grid grid-cols-[2rem_1fr_2.5rem_2.5rem_2.5rem_3.5rem] gap-x-2 items-center px-4 py-2.5 text-sm ${isMe ? 'bg-primary/10' : ''}`}
              >
                <span className="text-muted-foreground font-medium">{idx + 1}</span>
                <span className={`truncate font-medium ${isMe ? 'text-primary' : ''}`}>{entry.name}</span>
                <span className="text-center font-semibold" style={{ color: 'var(--rq-success)' }}>{entry.wins}</span>
                <span className="text-center text-muted-foreground">{entry.draws}</span>
                <span className="text-center text-muted-foreground">{entry.losses}</span>
                <span className="text-center font-semibold text-xs">
                  {total === 0 ? '—' : pts.toFixed(3)}
                </span>
              </div>
            );
          })}
          {sorted.length === 0 && (
            <div className="px-4 py-8 text-center text-muted-foreground text-sm">
              No completed challenges yet
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
