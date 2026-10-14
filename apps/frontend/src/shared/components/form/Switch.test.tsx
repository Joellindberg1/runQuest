import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Switch } from './Switch';

function Harness({ initial = false, disabled = false, note, onChange }: { initial?: boolean; disabled?: boolean; note?: string; onChange?: (next: boolean) => void }) {
  const [checked, setChecked] = useState(initial);
  return (
    <Switch
      label="Someone takes a title from you"
      note={note}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(next) => {
        onChange?.(next);
        setChecked(next);
      }}
    />
  );
}

describe('Switch', () => {
  it('är en switch med meningen som namn och aria-checked efter läget', () => {
    render(<Harness initial />);
    expect(screen.getByRole('switch', { name: 'Someone takes a title from you' })).toBeChecked();
  });

  it('ett klick byter läge och rapporterar det nya värdet', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const toggle = screen.getByRole('switch');

    await user.click(toggle);
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  it('nås med Tab och byter läge med både Mellanslag och Enter', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const toggle = screen.getByRole('switch');

    await user.tab();
    expect(toggle).toHaveFocus();
    await user.keyboard(' ');
    expect(toggle).toBeChecked();
    await user.keyboard('{Enter}');
    expect(toggle).not.toBeChecked();
  });

  it('inaktiverad: kvar i tabbordningen och läsbar, men ett klick eller tangent ändrar ingenting', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial disabled onChange={onChange} />);
    const toggle = screen.getByRole('switch');

    await user.tab();
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    await user.click(toggle);
    await user.keyboard(' ');
    await user.keyboard('{Enter}');
    expect(onChange).not.toHaveBeenCalled();
    expect(toggle).toBeChecked();
  });

  it('anteckningen är switchens beskrivning, inte en del av dess namn', () => {
    render(<Harness note="Off by default" />);
    const toggle = screen.getByRole('switch', { name: 'Someone takes a title from you' });
    expect(toggle).toHaveAccessibleDescription('Off by default');
  });

  it('utan anteckning finns ingen aria-describedby', () => {
    render(<Harness />);
    expect(screen.getByRole('switch')).not.toHaveAttribute('aria-describedby');
  });
});
