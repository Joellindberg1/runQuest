import React from 'react';
import { EmptyState } from '@/shared/components/EmptyState';
import { paths } from '@/paths';

// /news är registrerad så att klockikonen kan länka hit; innehållet kommer i inkrement 9 (ADR 008).
const NewsPage: React.FC = () => (
  <EmptyState
    title="Pack News"
    text="Pack News kommer i inkrement 9."
    actionLabel="Back to the board"
    actionTo={paths.board}
  />
);

export default NewsPage;
