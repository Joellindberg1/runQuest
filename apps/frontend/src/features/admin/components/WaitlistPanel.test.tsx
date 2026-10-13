import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import AdminPage from '@/pages/AdminPage';
import { AppRoutes } from '@/routes';
import type { AdminWaitlistEntry } from '@runquest/shared';
import { handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
vi.mock('@/features/onboarding/components/FeatureTour', () => ({ FeatureTour: () => null }));

const entry = (id: string, email: string, created_at: string): AdminWaitlistEntry => ({ id, email, created_at, source: 'landing' });
// Nyast är alfabetiskt sist: en klientsidig omsortering på e-post ska fälla ordningstestet.
const ZOE = entry('w2', 'zoe@example.com', '2026-10-13T08:00:00Z');
const ANNA = entry('w1', 'anna@example.com', '2026-10-12T12:00:00Z');

const SLOW = { timeout: 4000 };

function renderAdmin(entryPath: string) {
  return renderWithApp(
    <Routes>
      <Route path="/admin" element={<AdminPage />} />
    </Routes>,
    { entry: entryPath, admin: true },
  );
}

beforeEach(() => {
  resetFakeBackend();
  handlers.getAdminSettings = () => ({ success: true, data: { base_xp: 15, xp_per_km: 2, bonus_5km: 5, bonus_10km: 15, bonus_15km: 25, bonus_20km: 50, min_run_distance: 1 } });
  handlers.getStreakMultipliers = () => ({ success: true, data: [] });
  handlers.getAllUsers = () => ({ success: true, data: [] });
});

describe('Admin — waitlist', () => {
  it('admin waitlist tab lists signups and the total', async () => {
    handlers.getAdminWaitlist = () => ({ success: true, data: { entries: [ZOE, ANNA], total: 2 } });
    renderAdmin('/admin?view=waitlist');

    const list = await screen.findByRole('list', { name: 'Waitlist' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('zoe@example.com');
    expect(rows[0]).toHaveTextContent('13 October 2026');
    expect(rows[1]).toHaveTextContent('anna@example.com');
    expect(rows[1]).toHaveTextContent('12 October 2026');
    expect(screen.getByText('2 signups')).toBeInTheDocument();
    expect(screen.queryByText(/Showing the latest/)).not.toBeInTheDocument();
  });

  it('admin waitlist tab says when the list is cut short of the total', async () => {
    handlers.getAdminWaitlist = () => ({ success: true, data: { entries: [ZOE, ANNA], total: 1234 } });
    renderAdmin('/admin?view=waitlist');

    await screen.findByRole('list', { name: 'Waitlist' });
    expect(screen.getByText('1234 signups')).toBeInTheDocument();
    expect(screen.getByText('Showing the latest 2 of 1234')).toBeInTheDocument();
  });

  it('admin waitlist tab opens from the tab bar', async () => {
    handlers.getAdminWaitlist = () => ({ success: true, data: { entries: [ANNA], total: 1 } });
    renderAdmin('/admin');

    fireEvent.click(await screen.findByRole('tab', { name: 'Waitlist' }));
    expect(await screen.findByText('anna@example.com')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('view=waitlist');
  });

  it('admin waitlist tab shows an empty state', async () => {
    handlers.getAdminWaitlist = () => ({ success: true, data: { entries: [], total: 0 } });
    renderAdmin('/admin?view=waitlist');

    expect(await screen.findByText('No one has joined the waitlist yet.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Waitlist' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('admin waitlist tab shows a loading state while the list loads', async () => {
    handlers.getAdminWaitlist = () => new Promise(() => {});
    renderAdmin('/admin?view=waitlist');

    expect(await screen.findByText('Loading the waitlist')).toBeInTheDocument();
    expect(screen.queryByText('No one has joined the waitlist yet.')).not.toBeInTheDocument();
  });

  it('admin waitlist tab shows an error state when loading fails', async () => {
    handlers.getAdminWaitlist = () => ({ success: false, error: 'down' });
    renderAdmin('/admin?view=waitlist');

    expect(await screen.findByRole('button', { name: 'Retry' }, SLOW)).toBeInTheDocument();
    expect(screen.queryByText('No one has joined the waitlist yet.')).not.toBeInTheDocument();

    handlers.getAdminWaitlist = () => ({ success: true, data: { entries: [ANNA], total: 1 } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('anna@example.com')).toBeInTheDocument();
  });

  it('admin waitlist tab is not reachable for non-admins', async () => {
    const load = vi.fn().mockResolvedValue({ success: true, data: { entries: [ANNA], total: 1 } });
    handlers.getAdminWaitlist = load;
    renderWithApp(<AppRoutes />, { entry: '/admin?view=waitlist', admin: false });

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/board'));
    expect(screen.queryByRole('tab', { name: 'Waitlist' })).not.toBeInTheDocument();
    expect(screen.queryByText('anna@example.com')).not.toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
  });
});
