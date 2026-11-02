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

  describe('with arrow-key navigation (roving)', () => {
    function RovingHarness({ onChange }: { onChange: (next: Option) => void }) {
      const [value, setValue] = useState<Option>('activity');
      return (
        <>
          <button type="button">before</button>
          <SegmentedControl
            label="Overview"
            options={OPTIONS}
            value={value}
            onChange={(next) => {
              setValue(next);
              onChange(next);
            }}
            roving
          />
          <button type="button">after</button>
        </>
      );
    }

    it('is one tab stop: only the chosen option is reachable with Tab', async () => {
      const user = userEvent.setup();
      render(<RovingHarness onChange={vi.fn()} />);

      await user.tab();
      expect(screen.getByRole('button', { name: 'before' })).toHaveFocus();
      await user.tab();
      expect(screen.getByRole('button', { name: 'Activity' })).toHaveFocus();
      await user.tab();
      expect(screen.getByRole('button', { name: 'after' })).toHaveFocus();
      expect(screen.getByRole('button', { name: 'Distance' })).toHaveAttribute('tabindex', '-1');
      expect(screen.getByRole('button', { name: 'Activity' })).toHaveAttribute('tabindex', '0');
    });

    it('the arrows choose and focus the next and the previous option and loop round, Home and End go to the ends, and the tab stop follows the choice', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<RovingHarness onChange={onChange} />);

      await user.tab();
      await user.tab();
      await user.keyboard('{ArrowRight}');
      expect(screen.getByRole('button', { name: 'Distance' })).toHaveFocus();
      expect(screen.getByRole('button', { name: 'Distance' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Distance' })).toHaveAttribute('tabindex', '0');
      expect(screen.getByRole('button', { name: 'Activity' })).toHaveAttribute('tabindex', '-1');
      expect(onChange).toHaveBeenLastCalledWith('distance');

      await user.keyboard('{ArrowLeft}{ArrowLeft}');
      expect(screen.getByRole('button', { name: 'Streak' })).toHaveFocus();
      expect(onChange).toHaveBeenLastCalledWith('streak');

      await user.keyboard('{Home}');
      expect(screen.getByRole('button', { name: 'Activity' })).toHaveFocus();
      await user.keyboard('{End}');
      expect(screen.getByRole('button', { name: 'Streak' })).toHaveFocus();
      await user.keyboard('{ArrowRight}');
      expect(screen.getByRole('button', { name: 'Activity' })).toHaveFocus();
    });

    it('leaves Tab, Enter and the browser shortcuts (Shift, Ctrl, Alt, Meta plus an arrow) alone', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<RovingHarness onChange={onChange} />);

      await user.tab();
      await user.tab();
      await user.keyboard('{Alt>}{ArrowRight}{/Alt}{Control>}{End}{/Control}{Shift>}{ArrowRight}{/Shift}');
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Activity' })).toHaveFocus();
    });

    it('a click still chooses, and the default control keeps every option as a tab stop', async () => {
      const user = userEvent.setup();
      render(<RovingHarness onChange={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: 'Streak' }));
      expect(screen.getByRole('button', { name: 'Streak' })).toHaveAttribute('tabindex', '0');
      expect(screen.getByRole('button', { name: 'Activity' })).toHaveAttribute('tabindex', '-1');

      render(<Harness onChange={vi.fn()} />);
      for (const button of screen.getAllByRole('group', { name: 'Overview' }).at(-1)!.querySelectorAll('button')) expect(button).not.toHaveAttribute('tabindex');
    });
  });
});
