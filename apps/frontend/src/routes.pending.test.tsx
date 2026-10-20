import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/app-shell/PendingNavigate', () => ({ PendingNavigate: ({ to }: { to: string }) => <p>pending redirect to {to}</p> }));

import { AppRoutes } from './routes';

// Kopplingen: den gamla /challenges-adressen står utanför skalet och går genom den delade omdirigeringen med laddningsvyn, med sökparametrarna intakta. Att #root aldrig är tom
// bevisas i webbläsaren av apps/e2e/tests/transitions.spec.ts; att målet nås av routes.test.tsx.
describe('the legacy /challenges address', () => {
  it('redirects through the pending redirect to /duels, keeping the query', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/challenges?x=1']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(markup).toContain('pending redirect to /duels?x=1');
  });
});
