import React, { createContext, useContext, useState } from 'react';
import { UserProfileModal } from '@/components/UserProfileModal';

interface UserProfileModalContextValue {
  openProfile: (userId: string) => void;
}

const UserProfileModalContext = createContext<UserProfileModalContextValue>({
  openProfile: () => {},
});

export const useUserProfileModal = () => useContext(UserProfileModalContext);

export const UserProfileModalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [userId, setUserId] = useState<string | null>(null);

  return (
    <UserProfileModalContext.Provider value={{ openProfile: setUserId }}>
      {children}
      <UserProfileModal userId={userId} onClose={() => setUserId(null)} />
    </UserProfileModalContext.Provider>
  );
};
