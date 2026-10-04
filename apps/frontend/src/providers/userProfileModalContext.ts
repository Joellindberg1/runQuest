// Utflyttad från UserProfileModalProvider.tsx så att provider-filen bara exporterar
// komponenter (react-refresh/only-export-components). Samma kontext, samma beteende.
import { createContext, useContext } from 'react';

export interface UserProfileModalContextValue {
  openProfile: (userId: string) => void;
}

export const UserProfileModalContext = createContext<UserProfileModalContextValue>({
  openProfile: () => {},
});

export const useUserProfileModal = () => useContext(UserProfileModalContext);
