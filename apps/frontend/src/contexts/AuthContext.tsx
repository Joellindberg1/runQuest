import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/clientWithAuth';
import { Session } from '@supabase/supabase-js';

interface AuthContextType {
  user: unknown | null;
  session: Session | null;
  login: (nameOrEmail: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<unknown | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // 🔄 Auth-state listener
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('🔁 Auth state changed:', event, session?.user?.id);
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
          setUser(session.user); // fallback
        }
      } else {
        setUser(null);
      }

      setLoading(false);
    });

    // 🔄 Initial session fetch
    supabase.auth.getSession().then(({ data }) => {
      const session = data.session;
      setSession(session);

      if (session?.user) {
        supabase
          .from('users')
          .select('*')
          .eq('auth_user_id', session.user.id)
          .single()
          .then(({ data: userData, error }) => {
            if (userData && !error) {
              setUser(userData);
            } else {
              setUser(session.user);
            }
            setLoading(false);
          });
      } else {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // 🔐 Login: supports both Supabase Auth & legacy password
  const login = async (nameOrEmail: string, password: string) => {
    setLoading(true);

    try {
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .or(`name.eq.${nameOrEmail},email.eq.${nameOrEmail}`)
        .single();

      if (!userData || userError) {
        console.log('❌ User not found:', userError);
        return { success: false, error: 'User not found' };
      }

      // 1️⃣ Try Supabase Auth login
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: userData.email,
        password,
      });

      if (!signInError) {
        console.log('✅ Supabase Auth login succeeded:', userData.name);
        return { success: true };
      }

      // 2️⃣ Try legacy login
      const isLegacy = userData.password_hash !== 'migrated';
      if (isLegacy && password === userData.password_hash) {
        console.log('🕰 Legacy login accepted:', userData.name);
        setUser(userData); // manually set user
        setSession(null);  // no auth session
        return { success: true };
      }

      return { success: false, error: 'Invalid password' };
    } catch (err: unknown) {
      console.error('Login error:', err);
      return { success: false, error: 'Login failed' };
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    localStorage.removeItem('runquest_user');
  };

  return (
    <AuthContext.Provider value={{ user, session, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
