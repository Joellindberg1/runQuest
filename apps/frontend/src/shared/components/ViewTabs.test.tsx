import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ViewTabs } from './ViewTabs';

const TABS = [
  { key: 'a', label: 'Alpha' },
  { key: 'b', label: 'Beta' },
  { key: 'c', label: 'Gamma' },
] as const;

const setup = (value: 'a' | 'b' | 'c' = 'a') => {
  const onChange = vi.fn();
  render(<ViewTabs label="Views" tabs={TABS} value={value} onChange={onChange} idPrefix="t" />);
  return onChange;
};

describe('ViewTabs', () => {
  it('är en tablist med vald flik markerad och rörlig fokus (bara den valda är tabbbar)', () => {
    setup('b');
    expect(screen.getByRole('tablist', { name: 'Views' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('tabindex', '-1');
  });

  it('klick väljer flik', () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole('tab', { name: 'Gamma' }));
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('piltangenter flyttar markeringen och loopar runt', () => {
    const onChange = setup('c');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('a');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('b');
  });

  it('andra tangenter gör ingenting', () => {
    const onChange = setup();
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
