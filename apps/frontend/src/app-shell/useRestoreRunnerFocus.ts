import { useEffect, useRef } from 'react';
import { matchPath, NavigationType, useLocation, useNavigate, useNavigationType, type Location } from 'react-router-dom';
import { paths } from '@/paths';
import { readBackground, readFocusRunnerId } from '@/shared/hooks/useOpenRunner';
import { focusRunnerRowWhenRendered } from '@/shared/utils/focusRunnerRow';

/**
 * Löparen vars kort en navigering lämnade (sida eller popup), när det sker bakåt: Back/Esc/✕/skrim ur popupen och Back ur sidan är alla POP. Den direktladdade sidans tillbakalänk byter ut sin
 * post (REPLACE) och räknas också. Popupen byter ut sin post när Challenge öppnar send-flödet, och det flödet har egen fokushantering, så där räknas bara POP.
 */
function runnerCardLeft(before: Location | null, now: Location, type: NavigationType): string | null {
  if (!before || type === NavigationType.Push || matchPath(paths.runnerPattern, now.pathname)) return null;
  if (type === NavigationType.Replace && readBackground(before)) return null;
  return matchPath(paths.runnerPattern, before.pathname)?.params.id ?? null;
}

/**
 * Skalet ger fokus till löparens rad när sidan under en löpares kort kommer tillbaka, så att fokus inte blir kvar på `<body>`:
 * - ett avbrutet send-flöde som popupen öppnade navigerar med `state: { focusRunnerId }` (`FocusRunnerState`), som töms när fokus har flyttats;
 * - Back från löparens kort till sidan före det (`runnerCardLeft`): mobilens sida, och popupen när dess egen fokusåtergång inte körs (väntläget `PopupPending`, felkortet i `ShellErrorBoundary`).
 *   Den riktiga popupen flyttar fokus till samma rad i `onCloseAutoFocus`; att båda gör det är ofarligt.
 * Fokus flyttas när sidan har ritats och ingen dialog är öppen (`focusRunnerRowWhenRendered`), aldrig medan en dialog fortfarande döljer sidan.
 */
export function useRestoreRunnerFocus(): void {
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  // Platsen före den nuvarande. Uppdateras idempotent, så att effektens dubbelkörning i StrictMode inte tappar den.
  const trail = useRef<{ now: Location; before: Location | null }>({ now: location, before: null });

  useEffect(() => {
    if (trail.current.now !== location) trail.current = { now: location, before: trail.current.now };
    const requested = readFocusRunnerId(location.state);
    const runnerId = requested ?? runnerCardLeft(trail.current.before, location, navigationType);
    if (!runnerId) return;
    return focusRunnerRowWhenRendered(runnerId, () => {
      if (requested) void navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { replace: true, state: null });
    });
  }, [location, navigationType, navigate]);
}
