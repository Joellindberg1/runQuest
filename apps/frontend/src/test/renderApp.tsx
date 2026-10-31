import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext, type AuthContextType, type AuthUser } from '@/providers/authContext';
import { HistoryIdx } from './HistoryIdx';
import { LocationProbe } from './LocationProbe';
import { setViewportWidth } from './viewport';
import { ME } from './fakeBackend';

const AUTH_USER: AuthUser = { id: ME.id, name: ME.name, email: 'joel@example.com', is_admin: false };

type InitialEntry = NonNullable<MemoryRouterProps['initialEntries']>[number];

interface RenderOptions {
  entry?: InitialEntry | InitialEntry[];
  user?: AuthUser | null;
  admin?: boolean;
  width?: number;
  /** Skriv historikindexet (`window.history.state.idx`) som BrowserRouter gör; se HistoryIdx. Av som standard. */
  history?: boolean;
}

// Samma val som AppBrowserRouter (app-shell): v7 lägger annars adressbyten i en övergång, och ett prov som läser sidan direkt efter ett svar ser tillståndet före adressbytet.
export function renderWithApp(ui: React.ReactNode, { entry = '/', user = AUTH_USER, admin = false, width = 390, history = false }: RenderOptions = {}) {
  setViewportWidth(width);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } } });
  const auth: AuthContextType = {
    user: user ? { ...user, is_admin: admin } : null,
    login: async () => ({ success: true }),
    logout: () => {},
    loading: false,
    isAdmin: admin,
  };
  const entries = Array.isArray(entry) ? entry : [entry];

  // `queryClient` följer med så att ett prov kan ogiltigförklara eller läsa cachen, som en runda gör i appen.
  const result = render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={entries} useTransitions={false}>
          {history && <HistoryIdx start={entries.length - 1} />}
          {ui}
          <LocationProbe />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}
