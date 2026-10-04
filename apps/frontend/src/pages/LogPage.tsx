import React from 'react';
import { RunLogger } from '@/features/runs/components/RunLogger';
import { WithLeaderboardData } from './WithLeaderboardData';

// /log — den gamla RunLogger-fliken tills inkrement 7.
const LogPage: React.FC = () => (
  <WithLeaderboardData>
    {({ users, onRunUpdated }) => <RunLogger onSubmit={onRunUpdated} users={users} />}
  </WithLeaderboardData>
);

export default LogPage;
