import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProviders } from '@/providers';
import { useAuth } from '@/features/auth';
import { useAppInit } from '@/shared/hooks/useAppInit';
import Index from './pages/Index';
import AdminPage from './pages/AdminPage';
import LoginPage from './pages/LoginPage';
import SettingsPage from './pages/SettingsPage';
import FeaturesPage from './pages/FeaturesPage';
import StravaCallbackPage from './pages/StravaCallbackPage';
import LeaderboardPreviewPage from './pages/LeaderboardPreviewPage';
import NotFound from './pages/NotFound';

const AppContent = () => {
  const { user, loading, isAdmin } = useAuth();
  const path = window.location.pathname;

  useAppInit();

  // Strava popup-sidan hanteras som en separat HTML-fil utanför React
  if (path === '/strava-popup.html') {
    return null;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-xl text-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/preview" element={<LeaderboardPreviewPage />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/strava-callback" element={<StravaCallbackPage />} />
      <Route path="/" element={<Index />} />
      <Route path="/admin" element={isAdmin ? <AdminPage /> : <Navigate to="/" replace />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/features" element={<FeaturesPage />} />
      <Route path="/preview" element={<LeaderboardPreviewPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

const App = () => (
  <AppProviders>
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  </AppProviders>
);

export default App;
