import { useEffect, useRef } from 'react';
import { matchPath, useLocation, useNavigate, type Location } from 'react-router-dom';
import { paths } from '@/paths';
import { readFocusRunnerId } from '@/shared/hooks/routeState';
import { readBackground } from '@/shared/hooks/useOpenRunner';
import { dropRowSearchAfterBack } from '@/shared/utils/focusRowAfterBack';
import { focusRunnerRowWhenRendered } from '@/shared/utils/focusRunnerRow';
import { historyIdx } from '@/shared/utils/historyIdx';
import { takeRunnerFocus } from '@/shared/utils/runnerFocusIntent';
import { watchRunnerOpener } from '@/shared/utils/runnerOpener';

/** Hur platsbytet rörde sig i historiken, av `history.state.idx` före och efter: lägre = ett steg bakåt, lika = `replace`, högre = en ny post (eller framåt). */
type Move = 'back' | 'replace' | 'forward' | 'unknown';

const moveBetween = (before: number | null, now: number | null): Move => {
  if (before === null || now === null) return 'unknown';
  if (now < before) return 'back';
  return now === before ? 'replace' : 'forward';
};

/**
 * Löparen vars kort en navigering lämnade (sida eller popup), när det sker bakåt: Back/Esc/✕/skrim ur popupen och Back ur sidan är alla steg bakåt. Den direktladdade sidans
 * tillbakalänk byter ut sin post (`replace`) och räknas också. Popupen byter ut sin post när Challenge öppnar send-flödet, och det flödet har egen fokushantering, så där räknas bara
 * ett steg bakåt. Indexet i historiken läses i stället för `useNavigationType`, som drog med sig mer av react-router i chunken som landningen också laddar.
 */
function runnerCardLeft(before: Location | null, now: Location, move: Move): string | null {
  if (!before || matchPath(paths.runnerPattern, now.pathname)) return null;
  const wasPopup = readBackground(before) !== undefined;
  const leftBackwards = move === 'back' || (move === 'replace' && !wasPopup);
  return leftBackwards ? (matchPath(paths.runnerPattern, before.pathname)?.params.id ?? null) : null;
}

interface Trail {
  now: Location;
  before: Location | null;
  idx: number | null;
  move: Move;
  /** Avsikten som ett steg bakåt lämnade i minnet (`requestRunnerFocus`), hämtad en gång per platsbyte. */
  intent: string | null;
}

/**
 * Skalet ger fokus till löparens rad när sidan under en löpares kort kommer tillbaka, så att fokus inte blir kvar på `<body>`:
 * - ett avbrutet send-flöde som popupen öppnade: antingen en avsikt i minnet (ett steg bakåt, `requestRunnerFocus`) eller `state: { focusRunnerId }` (`FocusRunnerState`, ersatt post),
 *   som töms när fokus har flyttats;
 * - Back från löparens kort till sidan före det (`runnerCardLeft`): mobilens sida, och popupen när dess egen fokusåtergång inte körs (väntläget `PopupPending`, felkortet i `ShellErrorBoundary`).
 *   Den riktiga popupen flyttar fokus till samma rad i `onCloseAutoFocus`; att båda gör det är ofarligt.
 * Fokus flyttas när sidan har ritats och ingen dialog är öppen (`focusRunnerRowWhenRendered`), aldrig medan en dialog fortfarande döljer sidan. Målet är elementet som öppnade kortet,
 * annars löparens första synliga rad (`findRunnerTarget`): samma löpare står i flera rader i Duels History.
 */
export function useRestoreRunnerFocus(): void {
  const location = useLocation();
  const navigate = useNavigate();
  // Platsen före den nuvarande och vad som hör till bytet. Uppdateras bara när platsen har bytts: effekten kör också om på samma plats (`navigate` får ny identitet, t.ex. när routerns
  // navigator byts), och då får avsikten inte hämtas en gång till (den är redan tagen och skulle vara borta) eller platsen före skrivas över med den nuvarande. Bevisat i useRestoreRunnerFocus.test.tsx.
  // StrictModes dubbelkörning vid montering skiljer inte varianterna åt: spåret skapas då första gången, så båda gör samma sak.
  const trail = useRef<Trail | null>(null);

  // Elementet som öppnar löparens kort minns skalet här: fokus ska tillbaka till det, inte till löparens första rad (`findRunnerTarget`).
  useEffect(() => watchRunnerOpener(), []);

  useEffect(() => {
    const idx = historyIdx();
    if (trail.current === null) trail.current = { now: location, before: null, idx, move: 'unknown', intent: null };
    else if (trail.current.now !== location) {
      // Ett ark som Back stängde under ett skick söker efter löparens rad (`focusRunnerRowAfterBack`) och har ingen effekt kvar att städa med: ett nytt platsbyte avslutar den.
      dropRowSearchAfterBack();
      trail.current = { now: location, before: trail.current.now, idx, move: moveBetween(trail.current.idx, idx), intent: takeRunnerFocus() };
    }
    const { before, move, intent } = trail.current;
    const requested = readFocusRunnerId(location.state);
    const runnerId = requested ?? intent ?? runnerCardLeft(before, location, move);
    if (!runnerId) return;
    return focusRunnerRowWhenRendered(runnerId, () => {
      if (requested) void navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { replace: true, state: null });
    });
  }, [location, navigate]);
}
