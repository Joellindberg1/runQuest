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
    <header className="grid grid-cols-[1fr_auto_1fr] items-center px-4 md:px-6 py-3 bg-background">
      {/* Left: hamburger (mobile only) */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="md:hidden p-2"
          onClick={onMenuToggle}
        >
          <Menu className="w-5 h-5" />
        </Button>
      </div>

      {/* Center: group name — grid center col so it's truly centered within the full TopBar */}
      <h1 className="text-2xl md:text-3xl font-bold text-foreground text-center leading-tight">
        {groupName}
      </h1>

      {/* Right: notification + theme switch + profile icon — hidden on mobile (moved to sidebar) */}
      <div className="flex items-center gap-2 md:gap-3 justify-end">
        <div className="hidden md:contents">
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
              className="data-[state=checked]:bg-primary border border-foreground/30 [&>span]:border [&>span]:border-foreground/20"
            />
            <Moon className="w-3.5 h-3.5 text-muted-foreground" />
          </div>

          {/* Profile dropdown */}
          <ProfileMenu />
        </div>
      </div>
    </header>
  );
};
