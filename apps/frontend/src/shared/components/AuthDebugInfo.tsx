import React from 'react';
import { backendApi } from '@/shared/services/backendApi';

export const AuthDebugInfo: React.FC = () => {
  const isAuthenticated = backendApi.isAuthenticated();
  const token = backendApi.getToken();
  const user = backendApi.getCurrentUser();

  return (
    <div className="bg-gray-100 p-4 rounded border m-4">
      <h3 className="font-bold mb-2">🔍 Auth Debug Info</h3>
      <div className="space-y-1 text-sm">
        <div>
          <strong>Authenticated:</strong> {isAuthenticated ? '✅ Yes' : '❌ No'}
        </div>
        <div>
          <strong>Token exists:</strong> {token ? '✅ Yes' : '❌ No'}
        </div>
        <div>
          <strong>Token preview:</strong> {token ? `${token.substring(0, 20)}...` : 'None'}
        </div>
        <div>
          <strong>User:</strong> {user ? `${user.name} (${user.email})` : 'None'}
        </div>
        <div>
          <strong>API Base URL:</strong> {import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}
        </div>
      </div>
    </div>
  );
};
