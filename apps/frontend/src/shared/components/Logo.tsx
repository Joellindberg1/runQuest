import { useTheme } from '@/providers/ThemeProvider';

interface LogoProps {
  className?: string;
}

export const Logo = ({ className = 'h-10' }: LogoProps) => {
  const { theme } = useTheme();
  return (
    <img
      src={theme === 'dark' ? '/logo-dark.png' : '/logo-light.png'}
      alt="RunQuest"
      className={className}
    />
  );
};
