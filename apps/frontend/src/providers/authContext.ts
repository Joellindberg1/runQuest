// Utflyttad från AuthProvider.tsx så att provider-filen bara exporterar komponenter
// (react-refresh/only-export-components). Samma kontext, samma beteende.
import { createContext, useContext } from 'react';

export interface AuthUser {
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

export interface AuthContextType {
  user: AuthUser | null;
  login: (nameOrEmail: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  loading: boolean;
  isAdmin: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
