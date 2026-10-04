import React from 'react';
import { StravaSettings } from '@/features/settings/StravaSettings';
import { PasswordSettings } from '@/features/settings/PasswordSettings';

export const SettingsPage: React.FC = () => {
  return (
    <>
      <div className="max-w-2xl mx-auto space-y-6">
        <StravaSettings />
        <PasswordSettings />
      </div>
    </>
  );
};

export default SettingsPage;
