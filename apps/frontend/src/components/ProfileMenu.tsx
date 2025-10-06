
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { User, Settings, LogOut, Info, Shield } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

export const ProfileMenu: React.FC = () => {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();

  const handleDashboardClick = () => {
  navigate('/');
  };
  
  const handleSettingsClick = () => {
    navigate('/settings');
  };

  const handleFeaturesClick = () => {
    navigate('/features');
  };

  const handleAdminClick = () => {
    navigate('/admin');
  };

  const handleLogoutClick = () => {
    logout();
  };

  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-full w-10 h-10 p-0">
          {(user as any).profile_picture ? (
            <img 
              src={(user as any).profile_picture} 
              alt="Profile" 
              className="w-8 h-8 rounded-full object-cover"
            />
          ) : (
            <User className="w-4 h-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={handleDashboardClick}>
          <Settings className="w-4 h-4 mr-2" />
          Dashboard
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleSettingsClick}>
          <Settings className="w-4 h-4 mr-2" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleFeaturesClick}>
          <Info className="w-4 h-4 mr-2" />
          Features & Version
        </DropdownMenuItem>
        {isAdmin && (
          <DropdownMenuItem onClick={handleAdminClick}>
            <Shield className="w-4 h-4 mr-2" />
            Admin Panel
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={handleLogoutClick}>
          <LogOut className="w-4 h-4 mr-2" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
