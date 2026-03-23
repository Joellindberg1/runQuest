import React from 'react';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { User, Settings, LogOut, Shield } from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { useNavigate } from 'react-router-dom';

export const ProfileMenu: React.FC = () => {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();

  // Not logged in — show icon that navigates to login
  if (!user) return (
    <Button
      variant="ghost"
      size="icon"
      className="rounded-full w-9 h-9 ring-2 ring-foreground/50 bg-foreground/10 hover:bg-foreground/20 transition-colors"
      onClick={() => navigate('/')}
      title="Log in"
    >
      <User className="w-5 h-5" />
    </Button>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/*
          Ring makes the button visible in both themes without adding a hard border.
          bg-foreground/5 gives a subtle fill so the circle reads even on hover.
        */}
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full w-9 h-9 ring-2 ring-foreground/50 bg-foreground/10 hover:bg-foreground/20 transition-colors"
          title={user.name}
        >
          {user.profile_picture ? (
            <img
              src={user.profile_picture}
              alt="Profile"
              className="w-8 h-8 rounded-full object-cover"
            />
          ) : (
            <User className="w-5 h-5" />
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
