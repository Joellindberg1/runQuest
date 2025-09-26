import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface User {
  id: string;
  name: string;
  total_xp: number;
  current_level: number;
  total_km: number;
  current_streak: number;
  longest_streak: number;
  profile_picture?: string;
}

interface UserDataContextType {
  user: User | null;
  setCurrentUser: (userId: string) => Promise<void>;
  logout: () => void;
  loading: boolean;
}

const UserDataContext = createContext<UserDataContextType | undefined>(undefined);

export const UserDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedUserId = localStorage.getItem('currentUserId');
    if (storedUserId) {
      setCurrentUser(storedUserId);
    } else {
      setLoading(false);
    }
  }, []);

  const setCurrentUser = async (userId: string) => {
    try {
      setLoading(true);

      const { data: userData, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (error || !userData) throw error;

      setUser({
        id: userData.id,
        name: userData.name,
        total_xp: userData.total_xp || 0,
        current_level: userData.current_level || 1,
        total_km: parseFloat(userData.total_km?.toString() || '0'),
        current_streak: userData.current_streak || 0,
        longest_streak: userData.longest_streak || 0,
        profile_picture: userData.profile_picture || undefined,
      });

      localStorage.setItem('currentUserId', userId);
    } catch (err) {
      console.error('Failed to fetch user data:', err);
      logout();
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('currentUserId');
  };

  return (
    <UserDataContext.Provider value={{ user, setCurrentUser, logout, loading }}>
      {children}
    </UserDataContext.Provider>
  );
};

export const useUserData = () => {
  const context = useContext(UserDataContext);
  if (context === undefined) throw new Error('useUserData must be used within a UserDataProvider');
  return context;
};
