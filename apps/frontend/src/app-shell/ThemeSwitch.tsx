import { useTheme } from 'next-themes';
import { RQIcon } from '@/shared/components/icons';

const ICON_THEME = 15;

/** Mörkt/ljust (Web Prototype: sol · toggle · måne). Bara desktop-headern har den. */
export function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';

  return (
    <div className="rq-header__theme">
      <RQIcon name="sun" size={ICON_THEME} />
      <button
        type="button"
        role="switch"
        aria-checked={isDark}
        aria-label="Dark theme"
        className="rq-toggle"
        onClick={() => setTheme(isDark ? 'light' : 'dark')}
      />
      <RQIcon name="moon" size={ICON_THEME} />
    </div>
  );
}
