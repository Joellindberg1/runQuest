import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import SettingsPage from '@/pages/SettingsPage';
import { backendApiModule, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);

const fake = backendApiModule.backendApi as Record<string, unknown>;

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
const CONNECTED = { success: true, data: { connected: true, expired: false, connection_date: '2026-08-25T09:31:00Z' } };
const SYNC = { success: true, data: { last_sync_attempt: minutes(-32), last_sync_status: 'success', next_sync_estimated: minutes(28.5), new_runs: 2 } };

function renderSettings(options: Parameters<typeof renderWithApp>[1] = {}) {
  return renderWithApp(
    <Routes>
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>,
    { entry: '/settings', ...options },
  );
}

const SLOW = { timeout: 4000 };
const strava = () => screen.getByRole('region', { name: 'Strava' });

beforeEach(() => {
  resetFakeBackend();
  fake.isAuthenticated = () => true;
  handlers.getStravaStatus = () => CONNECTED;
  handlers.getStravaLastSync = () => SYNC;
  handlers.getStravaConfig = () => ({ success: true, data: { client_id: '12345' } });
});

afterEach(() => {
  delete fake.isAuthenticated;
  vi.unstubAllGlobals();
});

describe('Settings — Strava', () => {
  it('kopplad: grönt chip, de tre cellerna och reglerna om vad som importeras', async () => {
    renderSettings();
    const card = await screen.findByRole('region', { name: 'Strava' });
    expect(within(card).getByText('Connected', { selector: 'p' })).toBeInTheDocument();
    expect(within(card).getByText('25 August 2026')).toBeInTheDocument();
    expect(within(card).getByText('32 min ago')).toBeInTheDocument();
    expect(within(card).getByText('in 28 min')).toBeInTheDocument();
    expect(within(card).getByRole('list', { name: 'What gets imported' }).children).toHaveLength(3);
    expect(within(card).queryByRole('button', { name: /Connect Strava/ })).not.toBeInTheDocument();
  });

  it('senaste synken står i sidokortet', async () => {
    renderSettings();
    const latest = await screen.findByRole('region', { name: 'Latest sync' });
    expect(await within(latest).findByText('2 new runs')).toBeInTheDocument();
  });

  it('inte kopplad: "Connect Strava" öppnar Stravas auktorisering med klient-id:t och redirect till popup-sidan', async () => {
    handlers.getStravaStatus = () => ({ success: true, data: { connected: false, expired: false } });
    const open = vi.fn().mockReturnValue({});
    vi.stubGlobal('open', open);
    window.open = open;
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Strava' }));

    await waitFor(() => expect(open).toHaveBeenCalled());
    const [url] = open.mock.calls[0] as [string];
    expect(url).toContain('https://www.strava.com/oauth/authorize?client_id=12345');
    expect(url).toContain(encodeURIComponent(`${window.location.origin}/strava-popup.html`));
    expect(url).toContain('scope=activity:read');
  });

  it('blockerat popup-fönster: ett fel i kortets alert, inte en toast', async () => {
    handlers.getStravaStatus = () => ({ success: true, data: { connected: false, expired: false } });
    const open = vi.fn().mockReturnValue(null);
    window.open = open;
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Strava' }));
    expect(await within(strava()).findByRole('alert', { name: 'Strava error' })).toHaveTextContent('Allow pop-ups to connect Strava');
  });

  it('koden från OAuth-fönstret skickas till backend och bekräftelsen står i kortets status', async () => {
    handlers.getStravaStatus = () => ({ success: true, data: { connected: false, expired: false } });
    const connect = vi.fn().mockResolvedValue({ success: true });
    handlers.connectStrava = connect;
    renderSettings();
    await screen.findByRole('button', { name: 'Connect Strava' });

    handlers.getStravaStatus = () => CONNECTED;
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data: { stravaCode: 'abc' }, origin: window.location.origin }));
    });
    await waitFor(() => expect(connect).toHaveBeenCalledWith('abc'));
    expect(await within(strava()).findByRole('status', { name: 'Strava status' })).toHaveTextContent('Strava connected');
  });

  it('meddelanden från andra ursprung ignoreras', async () => {
    const connect = vi.fn().mockResolvedValue({ success: true });
    handlers.connectStrava = connect;
    renderSettings();
    await screen.findByRole('region', { name: 'Strava' });
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data: { stravaCode: 'evil' }, origin: 'https://evil.example' }));
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it('avbruten auktorisering i fönstret blir ett fel i kortet', async () => {
    renderSettings();
    await screen.findByRole('region', { name: 'Strava' });
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data: { error: 'access_denied' }, origin: window.location.origin }));
    });
    expect(await within(strava()).findByRole('alert', { name: 'Strava error' })).toHaveTextContent('Strava authorisation failed');
  });

  it('utgången koppling: "Reconnect Strava" rensar de gamla tokens innan ett nytt fönster öppnas', async () => {
    handlers.getStravaStatus = () => ({ success: true, data: { connected: true, expired: true } });
    const disconnect = vi.fn().mockResolvedValue({ success: true });
    handlers.disconnectStrava = disconnect;
    const open = vi.fn().mockReturnValue({});
    window.open = open;
    renderSettings();
    expect(await screen.findByText('Expired')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect Strava' }));
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('"Sync now" finns för ägaren, synkar och bekräftar med antalet nya rundor', async () => {
    const sync = vi.fn().mockResolvedValue({ success: true, data: { newRuns: 2, totalActivities: 9, message: 'ok' } });
    handlers.syncStrava = sync;
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
    expect(await within(strava()).findByRole('status', { name: 'Strava status' })).toHaveTextContent('Synced 2 new runs from Strava.');
  });

  it('misslyckad synk: serverns fel visas i alert', async () => {
    handlers.syncStrava = () => ({ success: false, error: 'Strava rate limit' });
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Sync now' }));
    expect(await within(strava()).findByRole('alert', { name: 'Strava error' })).toHaveTextContent('Strava rate limit');
  });

  it('andra användare ser ingen "Sync now"', async () => {
    renderSettings({ user: { id: 'u-karl', name: 'Karl Persson', email: 'karl@example.com' } });
    await screen.findByRole('region', { name: 'Strava' });
    expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument();
  });

  it('statusen går inte att läsa: felkort med Retry — och lösenordsbytet fungerar ändå', async () => {
    handlers.getStravaStatus = () => ({ success: false, error: 'down' });
    renderSettings();
    expect(await screen.findByRole('button', { name: 'Retry' }, SLOW)).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Password' })).toBeInTheDocument();
    handlers.getStravaStatus = () => CONNECTED;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('region', { name: 'Strava' })).toBeInTheDocument();
  });

  it('en enda guldknapp på sidan (Change password), även när Strava inte är kopplat', async () => {
    handlers.getStravaStatus = () => ({ success: true, data: { connected: false, expired: false } });
    const { container } = renderSettings();
    await screen.findByRole('button', { name: 'Connect Strava' });
    expect(container.querySelectorAll('.rq-btn--primary')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Change password' })).toHaveClass('rq-btn--primary');
  });
});

describe('Settings — lösenord', () => {
  const change = vi.fn();
  const fill = (current: string, next: string, confirm: string) => {
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } });
    fireEvent.change(screen.getByLabelText('Repeat new password'), { target: { value: confirm } });
  };
  const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

  beforeEach(() => {
    change.mockReset().mockResolvedValue({ success: true });
    handlers.changePassword = change;
  });

  it('tomt formulär: fel vid varje fält, fokus på det första, inget anrop', async () => {
    renderSettings();
    await screen.findByRole('region', { name: 'Strava' });
    submit();
    const current = screen.getByLabelText('Current password');
    await waitFor(() => expect(current).toHaveAttribute('aria-invalid', 'true'));
    expect(current).toHaveFocus();
    expect(current).toHaveAccessibleDescription('Enter your current password');
    expect(screen.getByLabelText('New password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Repeat new password')).toHaveAttribute('aria-invalid', 'true');
    expect(change).not.toHaveBeenCalled();
  });

  it('olika lösenord: felet står på bekräftelsefältet och ingenting skickas', async () => {
    renderSettings();
    await screen.findByRole('region', { name: 'Strava' });
    fill('old-secret', 'new-secret', 'new-different');
    submit();
    const confirm = screen.getByLabelText('Repeat new password');
    await waitFor(() => expect(confirm).toHaveAccessibleDescription('The new passwords do not match'));
    expect(confirm).toHaveFocus();
    expect(change).not.toHaveBeenCalled();
  });

  it('för kort nytt lösenord stoppas före anropet', async () => {
    renderSettings();
    await screen.findByRole('region', { name: 'Strava' });
    fill('old-secret', 'abc', 'abc');
    submit();
    await waitFor(() => expect(screen.getByLabelText('New password')).toHaveAccessibleDescription('Password must be at least 6 characters'));
    expect(change).not.toHaveBeenCalled();
  });

  it('lyckat byte: rätt anrop, fälten töms och bekräftelsen står i kortets status', async () => {
    renderSettings();
    await screen.findByRole('region', { name: 'Strava' });
    fill('old-secret', 'new-secret', 'new-secret');
    submit();
    await waitFor(() => expect(change).toHaveBeenCalledWith('old-secret', 'new-secret'));
    expect(await screen.findByRole('status', { name: 'Password status' })).toHaveTextContent('Password changed.');
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
  });

  it('serverns fel (fel nuvarande lösenord) visas i alert och fälten står kvar', async () => {
    change.mockResolvedValue({ success: false, error: 'Current password is incorrect' });
    renderSettings();
    await screen.findByRole('region', { name: 'Strava' });
    fill('wrong', 'new-secret', 'new-secret');
    submit();
    expect(await screen.findByRole('alert', { name: 'Password error' })).toHaveTextContent('Current password is incorrect');
    expect(screen.getByLabelText('New password')).toHaveValue('new-secret');
  });

  it('att skriva efter en bekräftelse tar bort den', async () => {
    renderSettings();
    await screen.findByRole('region', { name: 'Strava' });
    fill('old-secret', 'new-secret', 'new-secret');
    submit();
    await screen.findByText('Password changed.');
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'x' } });
    expect(screen.queryByText('Password changed.')).not.toBeInTheDocument();
  });
});
