import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Stake } from '../duelsFormat';
import { StakeBlocks } from './StakeBlocks';

const NO_BREAK_SPACE = ' ';

function renderStake(stake: Stake) {
  render(<StakeBlocks stake={stake} winLabel="Win" loseLabel="Lose" />);
}

describe('StakeBlocks', () => {
  it('keeps the duration together with its unit and the slash, so a narrow cell breaks before the slash', () => {
    renderStake({ win: '+0.5× / 14 d', lose: '−0.25× / 3 runs', loseTone: 'down', winFor: '', loseFor: '' });

    expect(screen.getByText('+0.5× / 14 d').textContent).toBe(`+0.5× /${NO_BREAK_SPACE}14${NO_BREAK_SPACE}d`);
    expect(screen.getByText('−0.25× / 3 runs').textContent).toBe(`−0.25× /${NO_BREAK_SPACE}3${NO_BREAK_SPACE}runs`);
  });

  it('shows a stake without a duration as it is', () => {
    renderStake({ win: '+0.5× / 14 d', lose: 'No penalty', loseTone: 'muted', winFor: '', loseFor: '' });

    expect(screen.getByText('No penalty').textContent).toBe('No penalty');
  });
});
