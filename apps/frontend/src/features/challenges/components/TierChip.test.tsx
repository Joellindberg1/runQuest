import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TierChip } from './TierChip';

describe('TierChip', () => {
  it('reads the tier and the count and reports its pressed state', () => {
    const { rerender } = render(<TierChip tier="minor" label="Minor" count={3} selected={false} onPress={() => {}} />);
    const chip = screen.getByRole('button', { name: 'Minor ×3' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    expect(chip).not.toHaveAttribute('aria-disabled');

    rerender(<TierChip tier="minor" label="Minor" count={3} selected onPress={() => {}} />);
    expect(screen.getByRole('button', { name: 'Minor ×3' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls onPress when pressed', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    render(<TierChip tier="major" label="Major" count={1} selected={false} onPress={onPress} />);
    await user.click(screen.getByRole('button', { name: 'Major ×1' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('an empty chip is aria-disabled but stays focusable and still reports a press, so the parent can explain', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    render(<TierChip tier="major" label="Major" count={0} selected={false} onPress={onPress} />);
    const chip = screen.getByRole('button', { name: 'Major ×0' });
    expect(chip).toHaveAttribute('aria-disabled', 'true');
    expect(chip).not.toBeDisabled();
    await user.tab();
    expect(chip).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('an empty chip never reads as pressed, even when asked to', () => {
    render(<TierChip tier="legendary" label="Legendary" count={0} selected onPress={() => {}} />);
    expect(screen.getByRole('button', { name: 'Legendary ×0' })).toHaveAttribute('aria-pressed', 'false');
  });
});
