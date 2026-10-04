import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ONBOARDING_QUERY_KEY } from '@/features/onboarding/hooks/useOnboarding';
import { supabase } from '@/integrations/supabase/clientWithAuth';
import { backendApi } from '@/shared/services/backendApi';
import { log } from '@/shared/utils/logger';
import { AuthContext } from '@/providers/authContext';
import type { AuthUser } from '@/providers/authContext';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const qc = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  // `loading` = sessionen återställs vid appstart (App.tsx gate:ar på den). Själva inloggningsanropet har ingen global loading:
  // den bytte ut hela routerträdet mot en loader, så LoginPage avmonterades och felet/fälten försvann (LoginPage har egen laddning).
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

    // Redirect to login automatically when JWT expires
    backendApi.onUnauthorized = () => {
      qc.removeQueries({ queryKey: ONBOARDING_QUERY_KEY });
      setUser(null);
    };

    return () => {
      backendApi.onUnauthorized = undefined;
    };
  }, [qc]);

  // 🔐 Login: uses backend API with JWT authentication
  const login = async (nameOrEmail: string, password: string) => {
    try {
      log.info('Attempting login with backend API', nameOrEmail);

      // Use backend API for login
      const loginResult = await backendApi.login(nameOrEmail, password);
      
      if (loginResult.success && loginResult.user) {
        log.success('Backend login successful', loginResult.user.name);
        // Sett-listan hör till en användare: ingen gammal (t.ex. utloggad prefetch) får finnas kvar när nästa läses.
        qc.removeQueries({ queryKey: ONBOARDING_QUERY_KEY });
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
    qc.removeQueries({ queryKey: ONBOARDING_QUERY_KEY });
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
};
