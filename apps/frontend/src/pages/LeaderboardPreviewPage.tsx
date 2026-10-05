import React from 'react';
import { SeasonBoard } from '@/features/leaderboard/components/SeasonBoard';
import '@/features/leaderboard/board.css';
import { ActiveChallengeWidget } from './preview/ActiveChallengeWidget';
import { PREVIEW_RANK_DELTAS, PREVIEW_USERS } from '@/features/leaderboard/previewUsers';
import type { Challenge } from '@runquest/types';

// ─── Mock Data ────────────────────────────────────────────────────────────────

// Löparna och rank-pilarna delas med Landing (features/leaderboard/previewUsers).
const MOCK_USERS = PREVIEW_USERS;
const MOCK_RANK_DELTAS = PREVIEW_RANK_DELTAS;

const MOCK_CURRENT_USER = MOCK_USERS[0];

// Förhandsvisningen ritar de RIKTIGA Board-komponenterna (SeasonBoard) med mockdata.

// Mock titles for preview — tests display of 3 titles + overflow label
const makeTitle = (title_id: string, title_name: string): import('@runquest/types').UserTitle => ({
  title_id,
  title_name,
  title_description: '',
  position: 1,
  value: 0,
  earned_at: '2026-01-01T00:00:00.000Z',
  is_current_holder: true,
  status: 'holder',
});

const MOCK_TITLE_OVERRIDES: Record<string, import('@runquest/types').UserTitle[]> = {
  'u1': [makeTitle('t0', 'The Iron Queen')],
  'u2': [
    makeTitle('t1', 'The Daaaaaviiiiiid GOGGINGS'),
    makeTitle('t2', 'The Reborn Eliud Kipchoge'),
    makeTitle('t3', 'The Weekend Destroyer'),
    makeTitle('t4', 'The Silent Pavement Predator'),
  ],
  'u3': [makeTitle('t5', 'Dawn Patrol Champion')],
  'u4': [makeTitle('t6', 'The Pavement Philosopher')],
  'u5': [makeTitle('t7', 'Midnight Mile Muncher')],
  'u6': [makeTitle('t8', 'The Reluctant Runner')],
  'u7': [makeTitle('t9', 'Perpetual Beginner')],
  'u8': [makeTitle('t10', 'Still Lacing Up')],
};

// Active challenge widget data
const endDate = new Date();
endDate.setDate(endDate.getDate() + 5);

const ACTIVE_CHALLENGE: Challenge = {
  id: 'c1', group_id: 'g1', tier: 'major',
  challenger_id: 'u1', challenger_name: 'Anna Lindqvist',
  opponent_id: 'u2', opponent_name: 'Erik Svensson',
  metric: 'km', duration_days: 10,
  winner_delta: 0.25, winner_duration: 10, winner_type: 'multiplier_days',
  loser_delta: -0.12, loser_duration: 10, loser_type: 'multiplier_days',
  challenger_level: 12, opponent_level: 10,
  end_date: endDate.toISOString().split('T')[0],
  status: 'active',
  created_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
};

const ACTIVE_PROGRESS = [
  { user_id: 'u1', name: 'Anna Lindqvist', value: 38.4 },
  { user_id: 'u2', name: 'Erik Svensson',  value: 31.1 },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

const LeaderboardPreviewPage: React.FC = () => {
  const widget = (
    <ActiveChallengeWidget
      challenge={ACTIVE_CHALLENGE}
      progress={ACTIVE_PROGRESS}
      currentUserId={MOCK_CURRENT_USER.id}
      onClick={() => window.location.assign('/preview/challenges')}
    />
  );

  return (
    <div className="min-h-screen bg-background p-4 md:p-8 space-y-4">
      {widget}
      <div className="rq-board">
        <SeasonBoard users={MOCK_USERS} titlesByUser={MOCK_TITLE_OVERRIDES} rankDeltaByUser={MOCK_RANK_DELTAS} now={new Date()} />
      </div>
    </div>
  );
};

export default LeaderboardPreviewPage;
