import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function renderList(showReward: boolean, onOpenRunner = vi.fn()) {
  render(
    <HistoryList
      status="ready" rows={[row]} mineOnly={false} onToggleMine={vi.fn()} hasMore={false} loadingMore={false} onLoadMore={vi.fn()}
      retrying={false} onRetry={vi.fn()} showReward={showReward} onOpenRunner={onOpenRunner}
    />,
  );
}

describe('the two halves of a history row', () => {
  it('has one button per participant, named after them, and nothing interactive inside another', () => {
    renderList(false);

    const match = within(screen.getByRole('list', { name: 'Matches' })).getAllByRole('listitem')[0]!;
    expect(within(match).getAllByRole('button').map((button) => button.textContent)).toEqual(['Maria Johansson', 'Olof Bergstrom']);
    expect(match.querySelectorAll('button button, button a, a button, a a')).toHaveLength(0);
  });

  it('opens the left participant from the left button and the right participant from the right button', async () => {
    const onOpenRunner = vi.fn();
    renderList(false, onOpenRunner);

    await userEvent.click(screen.getByRole('button', { name: 'Maria Johansson' }));
    await userEvent.click(screen.getByRole('button', { name: 'Olof Bergstrom' }));

    expect(onOpenRunner.mock.calls).toEqual([['u-maria'], ['u-olof']]);
  });

  it("describes each button with that participant's own score and result", () => {
    renderList(false);

    const describedBy = (name: string) => document.getElementById(screen.getByRole('button', { name }).getAttribute('aria-describedby')!)!.textContent;
    expect(describedBy('Maria Johansson')).toMatch(/41\.5.*Win|Win.*41\.5/);
    expect(describedBy('Maria Johansson')).not.toMatch(/Loss|38\.3/);
    expect(describedBy('Olof Bergstrom')).toMatch(/38\.3.*Loss|Loss.*38\.3/);
    expect(describedBy('Olof Bergstrom')).not.toMatch(/Win|41\.5/);
  });
});

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
