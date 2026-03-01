import React from 'react';
import { ProfileMenu } from '@/features/profile';
import { StravaSettings } from '@/features/settings/StravaSettings';
import { PasswordSettings } from '@/features/settings/PasswordSettings';

export const SettingsPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-4">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8">
          <div className="flex justify-between items-start mb-6">
            <div></div>
            <ProfileMenu />
          </div>
          <div className="text-center">
            <h1 className="text-4xl font-bold text-gray-800 mb-2">Settings</h1>
            <p className="text-lg text-gray-600">Manage your account and Strava connection</p>
          </div>
        </header>

        <div className="space-y-6">
          <StravaSettings />
          <PasswordSettings />
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
