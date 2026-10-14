import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { STRAVA_CONSENT_VERSION } from '@runquest/shared';
import SettingsPage from '@/pages/SettingsPage';
import { newsServer } from '@/features/news/news.fixture';
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
const CONSENT_KEY = 'rq.strava.consent';

/** Knappen är låst tills rutan är ikryssad (samtycket före Connect). */
async function agreeAndClick(name: 'Connect Strava' | 'Reconnect Strava') {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('checkbox', { name: 'I understand and agree' }));
  await user.click(screen.getByRole('button', { name }));
}

const sendMessage = (data: Record<string, unknown>) =>
  act(async () => {
    window.dispatchEvent(new MessageEvent('message', { data, origin: window.location.origin }));
  });

beforeEach(() => {
  sessionStorage.clear();
  resetFakeBackend();
  fake.isAuthenticated = () => true;
  handlers.getStravaStatus = () => CONNECTED;
  handlers.getStravaLastSync = () => SYNC;
  handlers.getStravaConfig = () => ({ success: true, data: { client_id: '12345' } });
  const news = newsServer([]);
  handlers.getSettings = news.getSettings;
  handlers.putSettings = (values) => news.putSettings(values as Parameters<typeof news.putSettings>[0]);
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
    await agreeAndClick('Connect Strava');

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
    await agreeAndClick('Connect Strava');
    expect(await within(strava()).findByRole('alert', { name: 'Strava error' })).toHaveTextContent('Allow pop-ups to connect Strava');
    expect(sessionStorage.getItem(CONSENT_KEY)).toBeNull();
  });

  describe('samtycket följer med genom OAuth-omdirigeringen', () => {
    let connect: Mock;

    beforeEach(() => {
      handlers.getStravaStatus = () => ({ success: true, data: { connected: false, expired: false } });
      connect = vi.fn().mockResolvedValue({ success: true });
      handlers.connectStrava = connect;
      window.open = vi.fn().mockReturnValue({});
    });

    it('consent is stored on click', async () => {
      renderSettings();
      expect(sessionStorage.getItem(CONSENT_KEY)).toBeNull();

      await agreeAndClick('Connect Strava');

      expect(sessionStorage.getItem(CONSENT_KEY)).toBe(STRAVA_CONSENT_VERSION);
    });

    it('it is sent in the callback, and the confirmation stands in the cards status', async () => {
      renderSettings();
      await agreeAndClick('Connect Strava');

      handlers.getStravaStatus = () => CONNECTED;
      await sendMessage({ stravaCode: 'abc' });

      await waitFor(() => expect(connect).toHaveBeenCalledWith('abc', STRAVA_CONSENT_VERSION));
      expect(await within(strava()).findByRole('status', { name: 'Strava status' })).toHaveTextContent('Strava connected');
    });

    it('it is removed after use', async () => {
      renderSettings();
      await agreeAndClick('Connect Strava');

      await sendMessage({ stravaCode: 'abc' });

      await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
      expect(sessionStorage.getItem(CONSENT_KEY)).toBeNull();
      await sendMessage({ stravaCode: 'again' });
      await waitFor(() => expect(connect).toHaveBeenCalledTimes(2));
      expect(connect.mock.calls[1][1]).toBeUndefined();
    });

    it('when it is missing, consent_version is not sent', async () => {
      renderSettings();
      await screen.findByRole('button', { name: 'Connect Strava' });

      await sendMessage({ stravaCode: 'abc' });

      await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
      expect(connect.mock.calls[0][0]).toBe('abc');
      expect(connect.mock.calls[0][1]).toBeUndefined();
    });

    it('a cancelled authorisation forgets the remembered consent', async () => {
      renderSettings();
      await agreeAndClick('Connect Strava');

      await sendMessage({ error: 'access_denied' });

      expect(await within(strava()).findByRole('alert', { name: 'Strava error' })).toHaveTextContent('Strava authorisation failed');
      expect(sessionStorage.getItem(CONSENT_KEY)).toBeNull();
    });

    it('a consent required response from the API shows an error and a reload hint', async () => {
      connect.mockResolvedValue({ success: false, error: 'Consent required' });
      renderSettings();
      await agreeAndClick('Connect Strava');

      await sendMessage({ stravaCode: 'abc' });

      const alert = await within(strava()).findByRole('alert', { name: 'Strava error' });
      expect(alert).toHaveTextContent(/privacy text has been updated/i);
      expect(alert).toHaveTextContent(/reload the page/i);
      expect(within(strava()).getByRole('button', { name: 'Connect Strava' })).toBeInTheDocument();
    });

    it('other connect errors keep the generic message', async () => {
      connect.mockResolvedValue({ success: false, error: 'Strava rate limit' });
      renderSettings();
      await agreeAndClick('Connect Strava');

      await sendMessage({ stravaCode: 'abc' });

      expect(await within(strava()).findByRole('alert', { name: 'Strava error' })).toHaveTextContent('Could not connect Strava');
    });
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

  describe('utgången koppling', () => {
    let disconnect: Mock;
    let open: Mock<typeof window.open>;

    beforeEach(() => {
      handlers.getStravaStatus = () => ({ success: true, data: { connected: true, expired: true } });
      // Disconnect raderar alla Stravarundor och kopplar ur hos Strava: Reconnect får aldrig röra den.
      disconnect = vi.fn().mockResolvedValue({ success: true });
      handlers.disconnectStrava = disconnect;
      open = vi.fn<typeof window.open>().mockReturnValue({} as Window);
      window.open = open;
    });

    it('reconnect on an expired connection opens the Strava window without calling disconnect', async () => {
      renderSettings();
      expect(await screen.findByText('Expired')).toBeInTheDocument();
      await agreeAndClick('Reconnect Strava');

      await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
      const [url] = open.mock.calls[0] as [string];
      expect(url).toContain('https://www.strava.com/oauth/authorize?client_id=12345');
      expect(disconnect).not.toHaveBeenCalled();
    });

    it('reconnect on an expired connection keeps the status as expired until the new connection succeeds', async () => {
      renderSettings();
      expect(await screen.findByText('Expired')).toBeInTheDocument();
      await agreeAndClick('Reconnect Strava');
      await waitFor(() => expect(open).toHaveBeenCalled());

      expect(within(strava()).getByText('Expired')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reconnect Strava' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Connect Strava' })).not.toBeInTheDocument();

      // Den nya kopplingen lyckas: först då byter kortet till kopplad.
      handlers.connectStrava = vi.fn().mockResolvedValue({ success: true });
      handlers.getStravaStatus = () => CONNECTED;
      await act(async () => {
        window.dispatchEvent(new MessageEvent('message', { data: { stravaCode: 'fresh' }, origin: window.location.origin }));
      });
      expect(await within(strava()).findByText('Connected', { selector: 'p' })).toBeInTheDocument();
      expect(within(strava()).queryByText('Expired')).not.toBeInTheDocument();
      expect(disconnect).not.toHaveBeenCalled();
    });

    it('denied authorisation in the Strava window leaves the card expired with the Reconnect button and an error', async () => {
      renderSettings();
      expect(await screen.findByText('Expired')).toBeInTheDocument();
      await agreeAndClick('Reconnect Strava');
      await waitFor(() => expect(open).toHaveBeenCalled());

      await act(async () => {
        window.dispatchEvent(new MessageEvent('message', { data: { error: 'access_denied' }, origin: window.location.origin }));
      });

      expect(await within(strava()).findByRole('alert', { name: 'Strava error' })).toHaveTextContent('Strava authorisation failed');
      expect(within(strava()).getByText('Expired')).toBeInTheDocument();
      expect(within(strava()).getByRole('button', { name: 'Reconnect Strava' })).toBeInTheDocument();
      expect(disconnect).not.toHaveBeenCalled();
    });

    it('a failed connect after the Strava window leaves the card expired with the Reconnect button and an error', async () => {
      const connect = vi.fn().mockResolvedValue({ success: false });
      handlers.connectStrava = connect;
      renderSettings();
      expect(await screen.findByText('Expired')).toBeInTheDocument();
      await agreeAndClick('Reconnect Strava');
      await waitFor(() => expect(open).toHaveBeenCalled());

      await act(async () => {
        window.dispatchEvent(new MessageEvent('message', { data: { stravaCode: 'bad' }, origin: window.location.origin }));
      });

      await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
      expect(connect.mock.calls[0][0]).toBe('bad');
      expect(await within(strava()).findByRole('alert', { name: 'Strava error' })).toHaveTextContent('Could not connect Strava');
      expect(within(strava()).getByText('Expired')).toBeInTheDocument();
      expect(within(strava()).getByRole('button', { name: 'Reconnect Strava' })).toBeInTheDocument();
      expect(disconnect).not.toHaveBeenCalled();
    });
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

describe('Settings — notiser', () => {
  it('visar Notifications-kortet och undertexten "Strava, notifications and password"', async () => {
    renderSettings();
    expect(screen.getByText('Strava, notifications and password')).toBeInTheDocument();
    const card = await screen.findByRole('region', { name: 'Notifications' });
    expect(within(card).getByText('Everything still lands in Pack News — this decides what reaches you.')).toBeInTheDocument();
    expect(await within(card).findAllByRole('switch')).not.toHaveLength(0);

    // Mellan Strava-kortet och lösenordskortet, som i designen.
    const strava = await screen.findByRole('region', { name: 'Strava' });
    const password = screen.getByRole('form', { name: 'Password' });
    expect(strava.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Settings fäller upp alla sektioner (här konfigurerar man).
    for (const toggle of within(card).getAllByRole('button', { expanded: true })) expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(card).queryByRole('button', { expanded: false })).not.toBeInTheDocument();
  });

  it('inställningarna går inte att läsa: kortet visar felet och Retry, och Strava och lösenordet fungerar ändå', async () => {
    handlers.getSettings = () => ({ success: false, error: 'down' });
    renderSettings();
    const card = await screen.findByRole('region', { name: 'Notifications' });
    expect(await within(card).findByRole('button', { name: 'Retry' }, SLOW)).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Strava' })).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Password' })).toBeInTheDocument();
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
