import React from 'react';
import { EmptyState } from '@/shared/components/EmptyState';
import { paths } from '@/paths';

// /news är registrerad så att klockikonen kan länka hit; innehållet byggs i inkrement 9 (ADR 008).
const NewsPage: React.FC = () => (
  <EmptyState
    title="Pack News"
    text="Coming soon — every title takeover, duel and level up in one feed."
    actionLabel="Back to the board"
    actionTo={paths.board}
  />
);

export default NewsPage;
