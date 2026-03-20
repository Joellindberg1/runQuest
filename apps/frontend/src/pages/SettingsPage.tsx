import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { StravaSettings } from '@/features/settings/StravaSettings';
import { PasswordSettings } from '@/features/settings/PasswordSettings';
import { useGroupName } from '@/shared/hooks/useGroupName';

export const SettingsPage: React.FC = () => {
  const groupName = useGroupName();
  return (
    <AppLayout groupName={groupName}>
      <div className="max-w-2xl mx-auto space-y-6">
        <StravaSettings />
        <PasswordSettings />
      </div>
    </AppLayout>
  );
};

export default SettingsPage;
