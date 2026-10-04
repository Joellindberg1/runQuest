import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext, type AuthContextType, type AuthUser } from '@/providers/authContext';
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
}

export function renderWithApp(ui: React.ReactNode, { entry = '/', user = AUTH_USER, admin = false, width = 390 }: RenderOptions = {}) {
  setViewportWidth(width);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const auth: AuthContextType = {
    user: user ? { ...user, is_admin: admin } : null,
    login: async () => ({ success: true }),
    logout: () => {},
    loading: false,
    isAdmin: admin,
  };
  const entries = Array.isArray(entry) ? entry : [entry];

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={entries}>
          {ui}
          <LocationProbe />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}
