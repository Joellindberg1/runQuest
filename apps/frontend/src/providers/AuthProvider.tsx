import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { backendApi } from '@/shared/services/backendApi';
import { log } from '@/shared/utils/logger';
import { AuthContext } from '@/providers/authContext';
import type { AuthUser, LoginOptions } from '@/providers/authContext';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const qc = useQueryClient();
  // Hela cachen rensas vid login, logout och 401: nästan allt är användarbundet (badges, grupp, users-with-runs, sett-listan, news)
  // och en nyckellista glömmer nästa feature. Inga undantag: den användaroberoende nivåtabellen hämtas bara om. Ingen loop:
  // clear() startar ingen omhämtning, det gör först en observatör som renderas om, och utan token är sidorna redan avmonterade.
  const clearUserCaches = () => qc.clear();
  const [user, setUser] = useState<AuthUser | null>(null);
  // `loading` = sessionen återställs vid appstart (App.tsx gate:ar på den). Själva inloggningsanropet har ingen global loading:
  // den bytte ut hela routerträdet mot en loader, så inloggningsdialogen avmonterades och felet/fälten försvann (LoginDialog har egen laddning).
  const [loading, setLoading] = useState(true);

  // Check if current user is admin
  const isAdmin = user?.is_admin ?? false;

  // 🔄 Initialize authentication state
  useEffect(() => {
    log.debug('Initializing authentication...');

    if (backendApi.isAuthenticated()) {
      const currentUser = backendApi.getCurrentUser();
      if (currentUser) {
        log.info('Found backend authentication', currentUser.name);
        setUser(currentUser);
      }
    } else {
      log.debug('No authentication found');
    }

    setLoading(false);

    // JWT har gått ut: användaren nollställs, RequireAuth skickar till /login?next=<sidan> (Landing med inloggningsdialogen öppen)
    backendApi.onUnauthorized = () => {
      qc.clear();
      setUser(null);
    };

    return () => {
      backendApi.onUnauthorized = undefined;
    };
  }, [qc]);

  // 🔐 Login: uses backend API with JWT authentication
  const login = async (nameOrEmail: string, password: string, options?: LoginOptions) => {
    try {
      log.info('Attempting login with backend API', nameOrEmail);

      // Use backend API for login
      const loginResult = await backendApi.login(nameOrEmail, password);

      // Avbrutet medan anropet pågick (dialogen lämnades): kasta svaret. backendApi.login har redan sparat token, så den rensas; ingen användare
      // sätts och ingen cache rensas, så Landing står kvar och ingenting skickar användaren till /board mot hens vilja.
      if (options?.signal?.aborted) {
        if (loginResult.success) backendApi.logout();
        log.info('Login abandoned by the user — response discarded');
        return { success: false, error: 'Login cancelled' };
      }

      if (loginResult.success) {
        log.success('Backend login successful', loginResult.user.name);
        // Cachen hör till en användare: inget gammalt (t.ex. utloggad prefetch eller förra användarens badges/grupp/sett-lista) får finnas kvar när nästa läses.
        clearUserCaches();
        setUser(loginResult.user);
        return { success: true };
      } else {
        log.warn('Backend login failed', loginResult.error);
        return { success: false, error: loginResult.error || 'Login failed' };
      }

    } catch (err: unknown) {
      log.error('Login error', err);
      return { success: false, error: 'Login failed' };
    }
  };

  const logout = async () => {
    log.info('Logging out...');
    
    backendApi.logout();
    clearUserCaches();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
};
