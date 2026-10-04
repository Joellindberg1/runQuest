import React, { useState } from 'react';
import { UserProfileModal } from '@/components/UserProfileModal';
import { UserProfileModalContext } from '@/providers/userProfileModalContext';

export const UserProfileModalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [userId, setUserId] = useState<string | null>(null);

  return (
    <UserProfileModalContext.Provider value={{ openProfile: setUserId }}>
      {children}
      <UserProfileModal userId={userId} onClose={() => setUserId(null)} />
    </UserProfileModalContext.Provider>
  );
};
