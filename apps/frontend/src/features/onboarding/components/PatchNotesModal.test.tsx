import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { PatchNote } from '@/features/changelog/changelogTypes';
import { PatchNotesModal } from './PatchNotesModal';

const NOTE: PatchNote = {
  slug: 'patch_v9.9.9',
  version: '9.9.9',
  title: 'Everything is new',
  changes: [
    { type: 'feature', description: 'A shiny new thing.' },
    { type: 'improvement', description: 'An old thing got better.' },
    { type: 'bugfix', description: 'A broken thing works again.' },
  ],
};

const open = () => act(() => { vi.advanceTimersByTime(500); });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('"What\'s new"-popupen', () => {
  it('väntar 500 ms innan den visas (layouten får sätta sig)', () => {
    render(<PatchNotesModal note={NOTE} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => { vi.advanceTimersByTime(499); });
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole('dialog', { name: 'Everything is new' })).toBeInTheDocument();
  });

  it('visar versionen, rubriken och varje punkt ur posten', () => {
    render(<PatchNotesModal note={NOTE} onClose={() => {}} />);
    open();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/What.s new · v9\.9\.9/)).toBeInTheDocument();
    const items = within(within(dialog).getByRole('list')).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(NOTE.changes.map((change) => change.description));
    expect(items.map((item) => item.getAttribute('data-kind'))).toEqual(['feature', 'improvement', 'bugfix']);
  });

  it('har EN guldknapp: "Got it" — och den stänger (markerar som sedd)', () => {
    const onClose = vi.fn();
    render(<PatchNotesModal note={NOTE} onClose={onClose} />);
    open();
    const dialog = screen.getByRole('dialog');
    const primary = [...dialog.querySelectorAll('button')].filter((button) => button.classList.contains('rq-btn--primary'));
    expect(primary).toHaveLength(1);
    expect(primary[0]).toHaveTextContent('Got it');
    fireEvent.click(primary[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('fokus hamnar på "Got it" (primärhandlingen), inte på ✕', () => {
    render(<PatchNotesModal note={NOTE} onClose={() => {}} />);
    open();
    expect(screen.getByRole('button', { name: 'Got it' })).toHaveFocus();
  });

  it('✕ och Escape stänger också, en gång var', () => {
    const onClose = vi.fn();
    render(<PatchNotesModal note={NOTE} onClose={onClose} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('visas inte alls om den avmonteras innan fördröjningen gått ut (inga kvarglömda timers)', () => {
    const { unmount } = render(<PatchNotesModal note={NOTE} onClose={() => {}} />);
    unmount();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
