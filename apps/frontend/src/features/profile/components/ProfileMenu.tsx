import React from 'react';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { User, Settings, LogOut, Shield, LogIn } from 'lucide-react';
import { useAuth } from '@/features/auth';
import { useNavigate } from 'react-router-dom';

export const ProfileMenu: React.FC = () => {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();

  // Not logged in — show login button
  if (!user) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="rounded-full w-9 h-9 p-0 border-border"
        onClick={() => navigate('/')}
        title="Log in"
      >
        <LogIn className="w-4 h-4" />
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="rounded-full w-9 h-9 p-0 border-border hover:border-primary transition-colors"
        >
          {user.profile_picture ? (
            <img
              src={user.profile_picture}
              alt="Profile"
              className="w-7 h-7 rounded-full object-cover"
            />
          ) : (
            <User className="w-4 h-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={() => navigate('/settings')}>
          <Settings className="w-4 h-4 mr-2" />
          Settings
        </DropdownMenuItem>
        {isAdmin && (
          <DropdownMenuItem onClick={() => navigate('/admin')}>
            <Shield className="w-4 h-4 mr-2" />
            Admin Panel
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={logout}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
