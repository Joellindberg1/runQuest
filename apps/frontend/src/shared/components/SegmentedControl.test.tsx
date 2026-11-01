import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SegmentedControl } from './SegmentedControl';

const OPTIONS = [
  { value: 'activity', label: 'Activity' },
  { value: 'distance', label: 'Distance' },
  { value: 'streak', label: 'Streak' },
] as const;

type Option = (typeof OPTIONS)[number]['value'];

function Harness({ onChange }: { onChange: (next: Option) => void }) {
  const [value, setValue] = useState<Option>('activity');
  return (
    <SegmentedControl
      label="Overview"
      options={OPTIONS}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('SegmentedControl', () => {
  it('segmented control sets aria-pressed on the chosen option and reports changes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    expect(screen.getByRole('group', { name: 'Overview' })).toBeInTheDocument();
    screen.getAllByRole('button').forEach((button) => expect(button).toHaveClass('rq-filter'));
    expect(screen.getByRole('button', { name: 'Activity' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Distance' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('button', { name: 'Streak' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('streak');
    expect(screen.getByRole('button', { name: 'Streak' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Activity' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('is operable from the keyboard: every option is a tab stop and Enter chooses it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.tab();
    expect(screen.getByRole('button', { name: 'Activity' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Distance' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('distance');
    expect(screen.getByRole('button', { name: 'Distance' })).toHaveAttribute('aria-pressed', 'true');
  });
});
