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
    <header className="flex items-center px-4 md:px-6 py-3 bg-background">
      {/* Left: hamburger (mobile only) */}
      <Button
        variant="ghost"
        size="sm"
        className="md:hidden p-2 shrink-0"
        onClick={onMenuToggle}
      >
        <Menu className="w-5 h-5" />
      </Button>

      {/* Center: group name — flex-1 + text-center so it's centered within the 85% content area */}
      <div className="flex-1 flex justify-center">
        <h1 className="text-xl md:text-2xl font-bold text-foreground whitespace-nowrap">
          {groupName}
        </h1>
      </div>

      {/* Right: notification + theme switch + profile icon */}
      <div className="flex items-center gap-2 md:gap-3 shrink-0">
        {/* Notification (placeholder) */}
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground"
          disabled
          title="Notifications — coming soon"
        >
          <Bell className="w-4 h-4" />
        </Button>

        {/* Light / Dark switch */}
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
