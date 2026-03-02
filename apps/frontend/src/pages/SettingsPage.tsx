import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { StravaSettings } from '@/features/settings/StravaSettings';
import { PasswordSettings } from '@/features/settings/PasswordSettings';

export const SettingsPage: React.FC = () => {
  return (
    <AppLayout groupName="Settings">
      <div className="max-w-2xl mx-auto space-y-6">
        <StravaSettings />
        <PasswordSettings />
      </div>
    </AppLayout>
  );
};

export default SettingsPage;
