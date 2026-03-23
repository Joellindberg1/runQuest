import React from 'react';
import { Menu, Bell } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { ThemeToggle } from '@/shared/components/ThemeToggle';
import { ProfileMenu } from '@/features/profile/components/ProfileMenu';
import { RunQuestLogo } from '@/shared/components/RunQuestLogo';

interface TopBarProps {
  onMenuToggle: () => void;
  groupName?: string;
}

export const TopBar: React.FC<TopBarProps> = ({ onMenuToggle }) => {
  return (
    <header className="flex items-center justify-between px-4 md:px-6 py-3 bg-background">
      {/* Left: hamburger (mobile) + logo (desktop) */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="md:hidden p-2 shrink-0"
          onClick={onMenuToggle}
        >
          <Menu className="w-5 h-5" />
        </Button>

        <RunQuestLogo className="h-14 w-auto text-foreground" />
      </div>

      {/* Right: utility icons — desktop only, moved to sidebar on mobile */}
      <div className="hidden md:flex items-center gap-3">
        <ThemeToggle />
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground"
          disabled
          title="Notifications — coming soon"
        >
          <Bell className="w-4 h-4" />
        </Button>
        <ProfileMenu />
      </div>
    </header>
  );
};
