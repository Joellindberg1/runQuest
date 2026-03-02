import React from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon } from 'lucide-react';
import { Switch } from '@/shared/components/ui/switch';

interface ThemeToggleProps {
  iconClass?: string;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({
  iconClass = 'text-muted-foreground',
}) => {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <div className="flex items-center gap-1.5">
      <Sun className={`w-3.5 h-3.5 ${iconClass}`} />
      <Switch
        checked={isDark}
        onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
        className="data-[state=checked]:bg-primary border border-foreground/30 [&>span]:border [&>span]:border-foreground/20"
      />
      <Moon className={`w-3.5 h-3.5 ${iconClass}`} />
    </div>
  );
};
