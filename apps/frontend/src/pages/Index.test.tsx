import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

const auth = vi.hoisted(() => ({ user: { id: 'u1' } as { id: string } | null }));
vi.mock('@/providers/authContext', () => ({ useAuth: () => auth }));
vi.mock('@/app-shell/PendingNavigate', () => ({ PendingNavigate: ({ to }: { to: string }) => <p>pending redirect to {to}</p> }));
vi.mock('./LandingPage', () => ({ default: () => <h1>Landing page</h1> }));
vi.mock('@/features/auth/components/LoginDialog', () => ({ LoginDialog: () => <p>Sign in dialog</p> }));

import Index from './Index';

// Kopplingen: en inloggad besökare på / eller /login lämnar sidan genom den delade omdirigeringen med laddningsvyn (PendingNavigate), och landningen ritas inte under tiden.
describe('the landing route for a signed-in visitor', () => {
  it.each([
    ['/login?next=%2Ftitles', '/titles', true],
    ['/', '/board', false],
  ])('%s redirects through the pending redirect to %s', (url, target, loginOpen) => {
    auth.user = { id: 'u1' };
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={[url]}>
        <Index loginOpen={loginOpen} />
      </MemoryRouter>,
    );

    expect(markup).toContain(`pending redirect to ${target}`);
    expect(markup).not.toContain('Landing page');
  });
});
