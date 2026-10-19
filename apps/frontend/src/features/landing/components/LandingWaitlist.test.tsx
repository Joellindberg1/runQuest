import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { StaticRouter } from 'react-router-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WAITLIST_CONSENT_LABEL, WAITLIST_CONSENT_LINK_TEXT, WAITLIST_EMAIL_MAX_LENGTH } from '@runquest/shared';
import { legalPrivacyPath } from '@/paths';
import userEvent from '@testing-library/user-event';
import { track } from '@/shared/analytics/track';
import { backendApi } from '@/shared/services/backendApi';
import { LandingWaitlist } from './LandingWaitlist';

vi.mock('@/shared/analytics/track', () => ({ track: vi.fn() }));

// Väntelistans kort: semantik, validering, lägen (skickar, klart, fel) och fokus. Anropets form och statusmappningen prövas i
// useJoinWaitlist.test.tsx och backendApi.waitlist.test.ts. user-event finns inte i projektet, så inmatning går via fireEvent.

vi.mock('@/shared/services/backendApi', () => ({ backendApi: { joinWaitlist: vi.fn() } }));
const joinWaitlist = vi.mocked(backendApi.joinWaitlist);

const renderForm = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <MemoryRouter>
        <LandingWaitlist />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const emailField = () => screen.getByLabelText('Email') as HTMLInputElement;
const consentBox = () => screen.getByRole('checkbox', { name: WAITLIST_CONSENT_LABEL }) as HTMLInputElement;
const submitButton = () => screen.getByRole('button', { name: /^(Join the waitlist|Joining…)$/ });
const form = () => screen.getByRole('form', { name: 'Join the waitlist' });

const fillIn = (email: string, consent = true) => {
  fireEvent.change(emailField(), { target: { value: email } });
  if (consent && !consentBox().checked) fireEvent.click(consentBox());
};
const send = () => fireEvent.submit(form());

beforeEach(() => {
  joinWaitlist.mockReset();
  joinWaitlist.mockResolvedValue({ status: 200 });
});

describe('LandingWaitlist', () => {
  it('är en sektion med id waitlist, rubriken Join the waitlist och ingressen', () => {
    const { container } = renderForm();
    const section = container.querySelector('section#waitlist');
    expect(section).not.toBeNull();
    const heading = screen.getByRole('heading', { level: 2, name: 'Join the waitlist' });
    expect(section!.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(screen.getByText(/RunQuest is invite-only while in beta\. Leave your email and you'll get an invite when a pack can start\./)).toBeInTheDocument();
    expect(screen.getByText('No app to install')).toBeInTheDocument();
    expect(screen.queryByText(/free/i)).toBeNull();
    expect(screen.queryByText(/Up to 30 runners/)).toBeNull();
  });

  it('har ett e-postfält med synlig etikett, rätt typ, autocomplete, required och maxlength', () => {
    renderForm();
    const field = emailField();
    expect(field.type).toBe('email');
    expect(field).toHaveAttribute('autocomplete', 'email');
    expect(field).toBeRequired();
    expect(field).toHaveAttribute('maxlength', String(WAITLIST_EMAIL_MAX_LENGTH));
    expect(screen.getByText('Email')).toBeVisible();
  });

  it('landningen gör inget POST förrän formuläret skickas', () => {
    renderForm();
    fireEvent.focus(emailField());
    fireEvent.change(emailField(), { target: { value: 'anna@example.com' } });
    fireEvent.click(consentBox());
    fireEvent.blur(emailField());
    expect(joinWaitlist).not.toHaveBeenCalled();
  });

  it('formuläret skickar e-post, samtycke, website och elapsedMs till /api/waitlist', async () => {
    renderForm();
    fillIn('  Anna@Example.com ');
    send();
    await screen.findByText("You're on the list.");
    expect(joinWaitlist).toHaveBeenCalledTimes(1);
    expect(joinWaitlist).toHaveBeenCalledWith({ email: 'Anna@Example.com', consent: true, website: '', elapsedMs: expect.any(Number) });
  });

  it('ett klick på guldknappen skickar formuläret', async () => {
    renderForm();
    fillIn('anna@example.com');
    fireEvent.click(submitButton());
    await screen.findByText("You're on the list.");
    expect(joinWaitlist).toHaveBeenCalledTimes(1);
  });

  it('formuläret skickar inte utan samtycke och visar felet vid bocken', () => {
    renderForm();
    fillIn('anna@example.com', false);
    send();
    expect(joinWaitlist).not.toHaveBeenCalled();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/tick the box/i);
    expect(consentBox()).toHaveAttribute('aria-invalid', 'true');
    expect(consentBox().getAttribute('aria-describedby')).toContain(alert.id);
    expect(emailField()).toHaveValue('anna@example.com');
  });

  it.each([['', /enter your email address/i], ['not-an-email', /valid email address/i], ['anna@', /valid email address/i]])(
    'formuläret skickar inte en ogiltig e-post och visar felet vid fältet (%j)',
    (value, message) => {
      renderForm();
      fillIn(value);
      send();
      expect(joinWaitlist).not.toHaveBeenCalled();
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(message);
      expect(emailField()).toHaveAttribute('aria-invalid', 'true');
      expect(emailField().getAttribute('aria-describedby')).toContain(alert.id);
      expect(emailField()).toHaveValue(value);
      expect(consentBox().checked).toBe(true);
    },
  );

  it('felet vid fältet försvinner när man skriver', () => {
    renderForm();
    fillIn('nope');
    send();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.change(emailField(), { target: { value: 'nope@example.com' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(emailField()).not.toHaveAttribute('aria-invalid');
  });

  it('servern som vägrar adressen (400) visar felet vid fältet och behåller det ifyllda', async () => {
    joinWaitlist.mockResolvedValue({ status: 400 });
    renderForm();
    fillIn('anna@example.com');
    send();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/valid email address/i);
    expect(emailField()).toHaveAttribute('aria-invalid', 'true');
    expect(emailField()).toHaveValue('anna@example.com');
  });

  it('formuläret visar samma tack för ny och redan anmäld adress', async () => {
    // Servern svarar 200 för båda; formuläret ser ingen skillnad.
    const first = renderForm();
    fillIn('anna@example.com');
    send();
    await screen.findByText("You're on the list.");
    const firstText = screen.getByRole('status').textContent;
    first.unmount();

    renderForm();
    fillIn('anna@example.com');
    send();
    await screen.findByText("You're on the list.");
    expect(screen.getByRole('status').textContent).toBe(firstText);
    expect(screen.queryByRole('form', { name: 'Join the waitlist' })).toBeNull();
  });

  it.each([
    [429, 'Too many tries. Try again in a few minutes.'],
    [500, 'Something went wrong. Try again.'],
    [413, 'Something went wrong. Try again.'],
  ])('formuläret visar ett begripligt fel vid %i och behåller det ifyllda', async (status, message) => {
    joinWaitlist.mockResolvedValue({ status });
    renderForm();
    fillIn('anna@example.com');
    send();
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(emailField()).toHaveValue('anna@example.com');
    expect(consentBox().checked).toBe(true);
    expect(submitButton()).toHaveTextContent('Join the waitlist');
  });

  it('formuläret visar samma felmening vid nätverksfel och går att skicka igen', async () => {
    joinWaitlist.mockResolvedValueOnce(null).mockResolvedValueOnce({ status: 200 });
    renderForm();
    fillIn('anna@example.com');
    send();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
    send();
    await screen.findByText("You're on the list.");
    expect(joinWaitlist).toHaveBeenCalledTimes(2);
  });

  it('knappen är låst medan formuläret skickar', async () => {
    let finish: (value: { status: number }) => void = () => {};
    joinWaitlist.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderForm();
    fillIn('anna@example.com');
    send();
    await waitFor(() => expect(submitButton()).toHaveAttribute('aria-busy', 'true'));
    expect(submitButton()).toHaveAttribute('aria-disabled', 'true');
    expect(submitButton()).toHaveTextContent('Joining…');
    fireEvent.click(submitButton());
    send();
    expect(joinWaitlist).toHaveBeenCalledTimes(1);
    finish({ status: 200 });
    await screen.findByText("You're on the list.");
  });

  it('fokus flyttas till tackmeddelandet', async () => {
    renderForm();
    fillIn('anna@example.com');
    send();
    const status = await screen.findByRole('status');
    expect(status).toHaveAttribute('tabindex', '-1');
    await waitFor(() => expect(status).toHaveFocus());
  });

  it('honeypot-fältet är dolt för skärmläsare och tangentbord', () => {
    const { container } = renderForm();
    const trap = container.querySelector('input[name="website"]') as HTMLInputElement;
    expect(trap).not.toBeNull();
    expect(trap).toHaveAttribute('tabindex', '-1');
    expect(trap).toHaveAttribute('autocomplete', 'off');
    expect(trap.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(trap).toHaveValue('');
    expect(screen.queryByRole('textbox', { name: /website/i })).toBeNull();
  });

  it('ett ifyllt honeypot-fält följer med i anropet', async () => {
    const { container } = renderForm();
    fireEvent.change(container.querySelector('input[name="website"]')!, { target: { value: 'http://spam.example' } });
    fillIn('anna@example.com');
    send();
    await screen.findByText("You're on the list.");
    expect(joinWaitlist).toHaveBeenCalledWith(expect.objectContaining({ website: 'http://spam.example' }));
  });

  it('samtyckestexten länkar till /legal', () => {
    renderForm();
    expect(screen.getByText(WAITLIST_CONSENT_LABEL)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: WAITLIST_CONSENT_LINK_TEXT });
    expect(link).toHaveAttribute('href', legalPrivacyPath);
    expect(link.getAttribute('href')!.startsWith('/legal')).toBe(true);
  });

  it('inloggningsrutan, pack-namnfältet och coming soon-texten finns inte', () => {
    const { container } = renderForm();
    for (const gone of [/Username/i, /Password/i, /Continue your journey/i, /Invited to a pack/i, /coming soon/i, /Starting your own pack/i, /pack name/i, /Wolfpack/i]) {
      expect(screen.queryByText(gone)).toBeNull();
      expect(screen.queryByLabelText(gone)).toBeNull();
    }
    expect(screen.queryByRole('button', { name: /^Create/i })).toBeNull();
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });

  it('texten lovar inget bekräftelsemejl', async () => {
    const { container } = renderForm();
    const before = container.textContent ?? '';
    expect(before).not.toMatch(/confirmation (email|mail)|check your (inbox|email)|we('ll| will) email you/i);
    fillIn('anna@example.com');
    send();
    await screen.findByText("You're on the list.");
    expect(screen.getByRole('status')).toHaveTextContent(/no confirmation email/i);
    expect(container.textContent).not.toMatch(/check your (inbox|email)|we('ll| will) email you/i);
  });

  it('inga andra guldknappar än Join the waitlist finns på sidan', () => {
    const { container } = renderForm();
    const gold = container.querySelectorAll('.rq-btn--primary');
    expect(gold).toHaveLength(1);
    expect(gold[0]).toBe(submitButton());
    expect(gold[0]).toHaveAccessibleName('Join the waitlist');
  });
});

describe('LandingWaitlist: webbanalys', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
  });

  it('reports waitlist-joined, with nothing about the address, when the server accepts the sign-up', async () => {
    renderForm();
    await userEvent.type(emailField(), 'anna@example.com');
    await userEvent.click(consentBox());
    await userEvent.click(submitButton());
    await screen.findByText("You're on the list.");
    expect(track).toHaveBeenCalledExactlyOnceWith('waitlist-joined');
  });

  it('reports nothing for a sign-up where the hidden honeypot field has been filled in, since that is a bot', async () => {
    renderForm();
    await userEvent.type(emailField(), 'bot@example.com');
    await userEvent.click(consentBox());
    fireEvent.change(document.querySelector('input[name="website"]') as HTMLInputElement, { target: { value: 'http://spam.example' } });
    await userEvent.click(submitButton());
    await screen.findByText("You're on the list.");
    expect(track).not.toHaveBeenCalled();
  });

  it.each([[400], [429], [500]])('reports nothing when the server answers %i', async (status) => {
    joinWaitlist.mockResolvedValue({ status });
    renderForm();
    await userEvent.type(emailField(), 'anna@example.com');
    await userEvent.click(consentBox());
    await userEvent.click(submitButton());
    await screen.findByRole('alert');
    expect(track).not.toHaveBeenCalled();
  });

  it('reports nothing for a sign-up that the form itself stops, or while typing', async () => {
    renderForm();
    await userEvent.type(emailField(), 'nope');
    await userEvent.click(submitButton());
    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
    expect(track).not.toHaveBeenCalled();
  });
});

// Formuläret ligger i den förrenderade HTML:en och syns innan landningens JS hydrerat det. Före hydreringen får det inte gå att fylla i eller skicka (värdena
// skulle skrivas över av tomt state, och Enter i fältet ger en nativ GET till /?website=): serverns markup är inert, och inerten släpps när komponenten monterats.
// Att det håller i en riktig webbläsare med riktig laddning prövas i apps/e2e/tests/landing-waitlist.spec.ts.
describe('LandingWaitlist: before and during hydration', () => {
  const withQueries = (children: ReactNode) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>
  );
  const serverTree = () => withQueries(<StaticRouter location="/"><LandingWaitlist /></StaticRouter>);
  const clientTree = () => withQueries(<MemoryRouter><LandingWaitlist /></MemoryRouter>);

  let container: HTMLElement;
  let root: Root | undefined;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = renderToString(serverTree());
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    container.remove();
    vi.restoreAllMocks();
  });

  it('is inert in the server markup, so nothing can be typed in or submitted until the page has hydrated', () => {
    expect(container.querySelector('form')).toHaveAttribute('inert');
  });

  it('becomes usable when it hydrates, with the same DOM nodes and no hydration errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const recoverable = vi.fn();
    const nodesBefore = Array.from(container.querySelectorAll('*'));

    await act(async () => {
      root = hydrateRoot(container, clientTree(), { onRecoverableError: recoverable });
    });

    expect(consoleError).not.toHaveBeenCalled();
    expect(recoverable).not.toHaveBeenCalled();
    const nodesAfter = Array.from(container.querySelectorAll('*'));
    expect(nodesAfter).toHaveLength(nodesBefore.length);
    expect(nodesAfter.every((node, index) => node === nodesBefore[index])).toBe(true);
    expect(container.querySelector('form')).not.toHaveAttribute('inert');

    const hydrated = within(container);
    await userEvent.type(hydrated.getByLabelText('Email'), 'anna@example.com');
    await userEvent.click(hydrated.getByRole('checkbox', { name: WAITLIST_CONSENT_LABEL }));
    await userEvent.click(hydrated.getByRole('button', { name: 'Join the waitlist' }));
    await hydrated.findByText("You're on the list.");
    expect(joinWaitlist).toHaveBeenCalledWith({ email: 'anna@example.com', consent: true, website: '', elapsedMs: expect.any(Number) });
  });

  it('is never inert when it is rendered on the client only', () => {
    container.remove();
    renderForm();
    expect(form()).not.toHaveAttribute('inert');
  });
});
