import React from 'react';
import { useTheme } from 'next-themes';
import { Bell, Menu, Sun, Moon } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { Switch } from '@/shared/components/ui/switch';
import { ProfileMenu } from '@/features/profile';

interface TopBarProps {
  groupName: string;
  onMenuToggle: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({ groupName, onMenuToggle }) => {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <header className="flex items-center justify-between px-4 md:px-6 py-3 border-b border-border bg-background">
      {/* Left: hamburger (mobile) + group name (mobile) */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="md:hidden p-2"
          onClick={onMenuToggle}
        >
          <Menu className="w-5 h-5" />
        </Button>
      </div>

      {/* Center: group name */}
      <h1 className="absolute left-1/2 -translate-x-1/2 text-xl md:text-2xl font-bold text-foreground whitespace-nowrap">
        {groupName}
      </h1>

      {/* Right: notification + theme + profile */}
      <div className="flex items-center gap-2 md:gap-3 ml-auto">
        {/* Notification icon (non-functional placeholder) */}
        <Button
          variant="ghost"
          size="sm"
          className="p-2 relative text-muted-foreground hover:text-foreground"
          disabled
          title="Notifications — coming soon"
        >
          <Bell className="w-4 h-4" />
        </Button>

        {/* Light / Dark theme switch */}
        <div className="flex items-center gap-1.5">
          <Sun className="w-3.5 h-3.5 text-muted-foreground" />
          <Switch
            checked={isDark}
            onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
            className="data-[state=checked]:bg-primary"
          />
          <Moon className="w-3.5 h-3.5 text-muted-foreground" />
        </div>

        {/* Profile dropdown */}
        <ProfileMenu />
      </div>
    </header>
  );
};
