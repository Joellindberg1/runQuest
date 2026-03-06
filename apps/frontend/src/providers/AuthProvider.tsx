import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/clientWithAuth';
import { backendApi } from '@/shared/services/backendApi';
import { log } from '@/shared/utils/logger';

interface User {
  id: string;
  name: string;
  email: string;
  is_admin?: boolean;
  total_xp?: number | null;
  current_level?: number | null;
  total_km?: number | null;
  current_streak?: number | null;
  longest_streak?: number | null;
  profile_picture?: string | null;
}

interface AuthContextType {
  user: User | null;
  login: (nameOrEmail: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  loading: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
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
    backendApi.onUnauthorized = () => setUser(null);

    return () => {
      backendApi.onUnauthorized = undefined;
    };
  }, []);

  // 🔐 Login: uses backend API with JWT authentication
  const login = async (nameOrEmail: string, password: string) => {
    setLoading(true);

    try {
      log.info('Attempting login with backend API', nameOrEmail);

      // Use backend API for login
      const loginResult = await backendApi.login(nameOrEmail, password);
      
      if (loginResult.success && loginResult.user) {
        log.success('Backend login successful', loginResult.user.name);
        setUser(loginResult.user);
        return { success: true };
      } else {
        log.warn('Backend login failed', loginResult.error);
        return { success: false, error: loginResult.error || 'Login failed' };
      }

    } catch (err: unknown) {
      log.error('Login error', err);
      return { success: false, error: 'Login failed' };
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    log.info('Logging out...');
    
    backendApi.logout();
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
