import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster as Sonner } from '@/shared/components/ui/sonner';
import { AuthProvider } from './AuthProvider';

const queryClient = new QueryClient();

export const AppProviders = ({ children }: { children: React.ReactNode }) => {
  // Mörkt är standard; ljust brons via data-theme (temafilen), inte .dark-klassen.
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="dark" enableSystem={false}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          {children}
          <Sonner />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
};
