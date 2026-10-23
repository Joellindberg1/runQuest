import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock('@/providers/authContext', () => ({ useAuth: () => auth }));
vi.mock('./PendingNavigate', () => ({ PendingNavigate: ({ to }: { to: string }) => <p>pending redirect to {to}</p> }));

import { RequireAuth } from './RequireAuth';

// Kopplingen: en utloggad besökare på en skyddad adress går genom den delade omdirigeringen med laddningsvyn (PendingNavigate), inte genom en blank <Navigate>.
describe('a protected route', () => {
  it('sends a signed-out visitor to the sign-in page through the pending redirect, keeping where they were going', () => {
    auth.user = null;
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/titles?view=all']}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route path="/titles" element={<h1>Titles page</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(markup).toContain('pending redirect to /login?next=%2Ftitles%3Fview%3Dall');
    expect(markup).not.toContain('Titles page');
  });
});
