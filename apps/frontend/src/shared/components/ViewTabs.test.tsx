import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('ViewTabs selects the first tab on Home', async () => {
    const user = userEvent.setup();
    const onChange = setup('c');
    screen.getByRole('tab', { name: 'Gamma' }).focus();
    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('a');
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveFocus();
  });

  it('ViewTabs selects the last tab on End', async () => {
    const user = userEvent.setup();
    const onChange = setup('a');
    screen.getByRole('tab', { name: 'Alpha' }).focus();
    await user.keyboard('{End}');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('c');
    expect(screen.getByRole('tab', { name: 'Gamma' })).toHaveFocus();
  });

  it('andra tangenter gör ingenting', () => {
    const onChange = setup();
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });
  it('standardvarianten är chip-flikar (rq-filter) utan ikon', () => {
    setup();
    const tab = screen.getByRole('tab', { name: 'Alpha' });
    expect(tab).toHaveClass('rq-filter');
    expect(tab.querySelector('svg')).toBeNull();
  });

  it('underline-varianten ger understrukna flikar (rq-tab) med valfri dekorativ ikon, samma tablist-beteende', () => {
    const onChange = vi.fn();
    render(
      <ViewTabs
        label="Stats"
        variant="underline"
        tabs={[{ key: 'a', label: 'Alpha', icon: 'list' }, { key: 'b', label: 'Beta' }] as const}
        value="a"
        onChange={onChange}
        idPrefix="u"
      />,
    );
    const alpha = screen.getByRole('tab', { name: 'Alpha' });
    expect(alpha).toHaveClass('rq-tab');
    expect(alpha).not.toHaveClass('rq-filter');
    expect(alpha.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('tab', { name: 'Beta' }).querySelector('svg')).toBeNull();

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
