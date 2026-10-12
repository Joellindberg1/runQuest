import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext, type AuthContextType } from '@/providers/authContext';
import { LocationProbe } from '@/test/LocationProbe';
import { LoginDialog } from './LoginDialog';

// Inloggningsdialogen (RUN-145, T1): semantik, fokus, fokusfälla, stängning och felvisning. Hela flödet genom App-trädet
// (Sign in-knappen, Back, lyckad inloggning → next) testas i App.login.test.tsx.

type Login = AuthContextType['login'];

const renderDialog = (login: Login = vi.fn().mockResolvedValue({ success: false, error: 'Invalid credentials' }), entry = '/login?next=%2Ftitles') => {
  const auth: AuthContextType = { user: null, login, logout: () => {}, loading: false, isAdmin: false };
  const opener = document.createElement('button');
  opener.textContent = 'opener';
  document.body.appendChild(opener);
  opener.focus();
  const view = render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[entry]}>
        <LoginDialog />
        <LocationProbe />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return { ...view, login, opener };
};

const dialog = () => screen.getByRole('dialog');
const location = () => screen.getByTestId('location').textContent;
const signIn = (name: string, password: string) => {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
};

afterEach(() => {
  document.querySelectorAll('body > button').forEach((node) => node.remove());
});

describe('LoginDialog: semantik och fokus', () => {
  it('är en modal dialog med namn (aria-labelledby → rubriken) och beskrivning', () => {
    renderDialog();

    expect(dialog()).toHaveAttribute('aria-modal', 'true');
    const labelledBy = dialog().getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)).toHaveTextContent('Sign in');
    expect(screen.getByRole('dialog', { name: 'Sign in' })).toHaveAccessibleDescription('Continue your journey');
  });

  it('fokus går till första fältet (Username), inte till ✕', async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByLabelText('Username')).toHaveFocus());
  });

  it('har EN guldknapp: Sign In', () => {
    renderDialog();
    expect(dialog().querySelectorAll('.rq-btn--primary')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Sign In' })).toHaveClass('rq-btn--primary');
  });

  it('allt utanför dialogen göms för hjälpmedel medan den är öppen (aria-hidden på syskonen)', () => {
    const { opener } = renderDialog();
    expect(opener).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('LoginDialog: stängning', () => {
  it('Escape stänger: adressen ersätts med / och next släpps (direktladdad /login har inget steg att gå tillbaka till)', async () => {
    renderDialog();
    expect(location()).toBe('/login?next=%2Ftitles');

    fireEvent.keyDown(dialog(), { key: 'Escape' });
    await waitFor(() => expect(location()).toBe('/'));
  });

  it('✕ stänger', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(location()).toBe('/'));
  });

  it('klick på scrimmen stänger', async () => {
    renderDialog();
    // Radix lyssnar på klick utanför först efter en tick.
    await waitFor(() => expect(screen.getByLabelText('Username')).toHaveFocus());
    fireEvent.pointerDown(document.querySelector('.rq-scrim') as HTMLElement);
    await waitFor(() => expect(location()).toBe('/'));
  });

  it('fokus lämnas tillbaka till det som hade det före dialogen (Landingens Sign in-länk) när dialogen avmonteras', async () => {
    const { opener, unmount } = renderDialog();
    await waitFor(() => expect(screen.getByLabelText('Username')).toHaveFocus());

    unmount();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  // En död ✕ utan signal (och ett login-anrop utan timeout) vore en fälla: dialogen går alltid att lämna. Försöket avbryts då, och svaret kastas (AuthProvider.login).
  it.each([
    ['Escape', () => fireEvent.keyDown(dialog(), { key: 'Escape' })],
    ['✕', () => fireEvent.click(screen.getByRole('button', { name: 'Close' }))],
    ['klick på scrimmen', () => fireEvent.pointerDown(document.querySelector('.rq-scrim') as HTMLElement)],
  ])('under pågående inloggning går dialogen att lämna med %s, och försöket avbryts när dialogen avmonteras', async (_name, leave) => {
    let signal: AbortSignal | undefined;
    const login = vi.fn((_name: string, _password: string, options?: { signal?: AbortSignal }) => {
      signal = options?.signal;
      return new Promise<{ success: boolean }>(() => {});
    });
    const { unmount } = renderDialog(login);
    await waitFor(() => expect(screen.getByLabelText('Username')).toHaveFocus());
    signIn('anna', 'hemligt');
    await screen.findByRole('button', { name: 'Signing in…' });
    expect(signal?.aborted).toBe(false);

    leave();
    await waitFor(() => expect(location()).toBe('/'));

    // Sidan (Index) avmonterar dialogen när adressen lämnat /login; då avbryts försöket.
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('ett svar som kommer efter att dialogen lämnats ger inget fel och inget tillstånd i en avmonterad komponent', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let finish: (value: { success: boolean; error?: string }) => void = () => {};
    const { unmount } = renderDialog(vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; })));
    await waitFor(() => expect(screen.getByLabelText('Username')).toHaveFocus());
    signIn('anna', 'hemligt');
    await screen.findByRole('button', { name: 'Signing in…' });
    unmount();

    await act(async () => { finish({ success: false, error: 'Invalid credentials' }); });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('LoginDialog: formuläret (som den gamla inloggningssidan)', () => {
  it('skickar det som skrivits via AuthProvider.login', async () => {
    const login = vi.fn().mockResolvedValue({ success: true });
    renderDialog(login);
    signIn('anna', 'hemligt');
    await waitFor(() => expect(login).toHaveBeenCalledWith('anna', 'hemligt', { signal: expect.any(AbortSignal) }));
  });

  it('felet visas i dialogen (role=alert), fälten står kvar och pekar på felet', async () => {
    renderDialog();
    signIn('anna', 'fel-losen');

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials'));
    expect(dialog()).toContainElement(screen.getByRole('alert'));
    const username = screen.getByLabelText('Username');
    expect(username).toHaveValue('anna');
    expect(screen.getByLabelText('Password')).toHaveValue('fel-losen');
    expect(username).toHaveAttribute('aria-invalid', 'true');
    expect(username).toHaveAccessibleDescription('Invalid credentials');
    expect(dialog()).toBeInTheDocument();
  });

  it('serverns rate-limit-text visas som den är (inget eget felspråk i klienten)', async () => {
    renderDialog(vi.fn().mockResolvedValue({ success: false, error: 'Too many attempts. Try again in 15 minutes.' }));
    signIn('anna', 'fel');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Too many attempts. Try again in 15 minutes.'));
  });

  it('under pågående inloggning: fälten readOnly (inte disabled), knappen aria-disabled, fokus tappas inte, nytt submit ignoreras', async () => {
    let finish: (value: { success: boolean; error?: string }) => void = () => {};
    const login = vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderDialog(login);
    const password = screen.getByLabelText('Password');
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'anna' } });
    fireEvent.change(password, { target: { value: 'hemligt' } });
    password.focus();
    fireEvent.submit(password.closest('form') as HTMLFormElement);

    const busy = await screen.findByRole('button', { name: 'Signing in…' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(busy).not.toBeDisabled();
    expect(password).toHaveAttribute('readonly');
    expect(password).not.toBeDisabled();
    expect(password).toHaveFocus();
    fireEvent.click(busy);
    expect(login).toHaveBeenCalledTimes(1);

    finish({ success: false, error: 'Invalid credentials' });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials'));
    expect(password).not.toHaveAttribute('readonly');
  });
});
