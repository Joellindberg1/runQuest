import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/clientWithAuth';
import { backendApi } from '@/shared/services/backendApi';
import { log } from '@/shared/utils/logger';
import { Session } from '@supabase/supabase-js';

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
  session: Session | null;
  login: (nameOrEmail: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  loading: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // Check if current user is admin
  const isAdmin = user?.is_admin ?? false;

  // 🔄 Initialize authentication state
  useEffect(() => {
    const initializeAuth = async () => {
      log.debug('Initializing authentication...');
      
      // Check for backend authentication first
      if (backendApi.isAuthenticated()) {
        const currentUser = backendApi.getCurrentUser();
        if (currentUser) {
          log.info('Found backend authentication', currentUser.name);
          setUser(currentUser);
          setLoading(false);
          return;
        }
      }

      // Fallback: Check Supabase session
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      setSession(session);

      if (session?.user) {
        log.debug('Found Supabase session', session.user.id);
        
        const { data: userData, error } = await supabase
          .from('users')
          .select('*')
          .eq('auth_user_id', session.user.id)
          .single();

        if (userData && !error) {
          setUser(userData as User);
        } else {
          // Convert Supabase user to our User type
          setUser({
            id: session.user.id,
            name: session.user.user_metadata?.name || session.user.email || 'Unknown',
            email: session.user.email || ''
          } as User);
        }
      } else {
        log.debug('No authentication found');
      }

      setLoading(false);
    };

    initializeAuth();

    // Set up Supabase auth state listener (for fallback)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      log.debug('Supabase auth state changed', event);
      
      // Only handle if no backend auth is active
      if (!backendApi.isAuthenticated()) {
        setSession(session);

        if (session?.user) {
          const { data: userData, error } = await supabase
            .from('users')
            .select('*')
            .eq('auth_user_id', session.user.id)
            .single();

          if (userData && !error) {
            setUser(userData as User);
          } else {
            // Convert Supabase user to our User type
            setUser({
              id: session.user.id,
              name: session.user.user_metadata?.name || session.user.email || 'Unknown',
              email: session.user.email || ''
            } as User);
          }
        } else {
          setUser(null);
        }
      }
    });

    return () => subscription.unsubscribe();
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
        setSession(null); // No Supabase session for backend auth
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
    
    // Clear backend authentication
    backendApi.logout();
    
    // Also clear Supabase session if exists
    await supabase.auth.signOut();
    
    // Clear local state
    setUser(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ user, session, login, logout, loading, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
