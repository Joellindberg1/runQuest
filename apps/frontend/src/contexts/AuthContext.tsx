import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/clientWithAuth';
import { backendApi } from '@/services/backendApi';
import { Session } from '@supabase/supabase-js';

interface AuthContextType {
  user: unknown | null;
  session: Session | null;
  login: (nameOrEmail: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  loading: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<unknown | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // Check if current user is admin
  const isAdmin = user && typeof user === 'object' && 'is_admin' in user 
    ? Boolean((user as any).is_admin) 
    : false;

  // 🔄 Initialize authentication state
  useEffect(() => {
    const initializeAuth = async () => {
      console.log('🔄 Initializing authentication...');
      
      // Check for backend authentication first
      if (backendApi.isAuthenticated()) {
        const currentUser = backendApi.getCurrentUser();
        if (currentUser) {
          console.log('✅ Found backend authentication:', currentUser.name);
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
        console.log('✅ Found Supabase session:', session.user.id);
        
        const { data: userData, error } = await supabase
          .from('users')
          .select('*')
          .eq('auth_user_id', session.user.id)
          .single();

        if (userData && !error) {
          setUser(userData);
        } else {
          setUser(session.user);
        }
      } else {
        console.log('ℹ️ No authentication found');
      }

      setLoading(false);
    };

    initializeAuth();

    // Set up Supabase auth state listener (for fallback)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('🔁 Supabase auth state changed:', event, session?.user?.id);
      
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
            setUser(userData);
          } else {
            setUser(session.user);
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
      console.log('🔐 Attempting login with backend API:', nameOrEmail);

      // Use backend API for login
      const loginResult = await backendApi.login(nameOrEmail, password);
      
      if (loginResult.success && loginResult.user) {
        console.log('✅ Backend login successful:', loginResult.user.name);
        setUser(loginResult.user);
        setSession(null); // No Supabase session for backend auth
        return { success: true };
      } else {
        console.log('❌ Backend login failed:', loginResult.error);
        return { success: false, error: loginResult.error || 'Login failed' };
      }

    } catch (err: unknown) {
      console.error('❌ Login error:', err);
      return { success: false, error: 'Login failed' };
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    console.log('🚪 Logging out...');
    
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
