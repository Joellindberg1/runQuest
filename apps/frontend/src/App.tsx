
import React, { useEffect } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { frontendLevelService } from "@/services/levelService";
import Index from "./pages/Index";
import AdminPage from "./pages/AdminPage";
import LoginPage from "./pages/LoginPage";
import SettingsPage from "./pages/SettingsPage";
import FeaturesPage from "./pages/FeaturesPage";
import StravaCallbackPage from "./pages/StravaCallbackPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const AppContent = () => {
  const { user, loading, isAdmin } = useAuth();
  const path = window.location.pathname;
  console.log('🔄 Current path:', path);

  // Initialize level service when app starts
  useEffect(() => {
    frontendLevelService.initialize().catch(console.error);
  }, []);

  // 🛑 UNDANTAG: Kör aldrig AppRouter på popup-sidan
  if (path === '/strava-popup.html') {
    return null; // Låt browsern ladda HTML-filen utan att React tar över
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/strava-callback" element={<StravaCallbackPage />} />
        {!user ? (
          <Route path="*" element={<LoginPage />} />
        ) : (
          <>
            <Route path="/" element={<Index />} />
            <Route path="/admin" element={isAdmin ? <AdminPage /> : <Navigate to="/" replace />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/features" element={<FeaturesPage />} />
            <Route path="*" element={<NotFound />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  );
};


const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <AppContent />
          <Toaster />
          <Sonner />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
