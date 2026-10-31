import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { HistoryRow } from '../duelsModel';
import { HistoryList } from './HistoryList';

const NO_BREAK_SPACE = '\u00a0';

const row: HistoryRow = {
  id: 'h1',
  left: { userId: 'u-maria', name: 'Maria Johansson', score: '41.5', result: 'Win', tone: 'up', mine: false, emphasis: true },
  right: { userId: 'u-olof', name: 'Olof Bergstrom', score: '38.3', result: 'Loss', tone: 'down', mine: false, emphasis: false },
  what: 'Legendary · Most km',
  days: '11 d',
  reward: '+0.5× / 14 d',
  date: '15 Oct',
  mine: false,
};

function renderList(showReward: boolean) {
  render(
    <HistoryList
      status="ready" rows={[row]} mineOnly={false} onToggleMine={vi.fn()} hasMore={false} loadingMore={false} onLoadMore={vi.fn()}
      retrying={false} onRetry={vi.fn()} showReward={showReward} onOpenRunner={vi.fn()}
    />,
  );
}

describe('the meta of a history row', () => {
  it('keeps the duration together on mobile, and the text is found with an ordinary space', () => {
    renderList(false);

    const meta = screen.getByText('Legendary · Most km · 11 d');
    expect(meta.textContent).toBe(`Legendary · Most km · 11${NO_BREAK_SPACE}d`);
  });

  it('keeps both durations together on desktop (the match and the reward), and the text is found with an ordinary space', () => {
    renderList(true);

    expect(screen.getByText('Legendary · Most km')).toBeInTheDocument();
    const detail = screen.getByText('11 d · +0.5× / 14 d');
    expect(detail.textContent).toBe(`11${NO_BREAK_SPACE}d · +0.5× / 14${NO_BREAK_SPACE}d`);
  });
});
