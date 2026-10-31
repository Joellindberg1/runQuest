import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { confirmationElement, duelsPageTarget } from '../focusTargets';

/** Nyckelroten för alla utmaningsfrågor: tokens och listorna som ett svar hämtar om (`useChallengeActions`). */
const CHALLENGES_QUERY_KEY = ['challenges'];

/** En bevakning av fokus för ett skick (`useFocusRescue().begin`). Alla anrop gäller bara om bevakningen fortfarande är den aktuella. */
export interface FocusWatch {
  /** Svaret har kommit medan arket är borta: nu får fokus hittas ett hem om det som hade det har försvunnit. */
  landed: () => void;
  /** Bevakningen behövs inte (arket var öppet när svaret kom och tar hand om fokus själv). */
  stop: () => void;
}

interface Watching {
  /** Det som hade fokus senast: öppnaren som arket gav fokus efter Back, eller det användaren flyttat det till. */
  focused: Element | null;
  landed: boolean;
  stopListening: () => void;
}

/**
 * Back under ett skick lämnar fokus på kortet eller knappen som öppnade arket. När ett sent svar sedan hämtar om tokens försvinner kortet (tokenet är förbrukat), webbläsaren lägger fokus på
 * `<body>` och användaren som styr med tangentbordet eller skärmläsare börjar om från sidans topp. Bevakningen följer vad som har fokus från det att skicket går iväg, och när svaret har landat och
 * det fokuserade elementet har försvunnit ur dokumentet flyttas fokus till bekräftelsen (eller felet), annars rubrikens Send. Bara då: har användaren flyttat fokus eller finns kortet kvar flyttas inget.
 * Bevakningen avslutas när inga utmaningsfrågor hämtas om längre (efter ett tidsgränssvar pågår omhämtningen fortfarande när svaret landar, och det är den som tar bort kortet).
 */
export function useFocusRescue(): { begin: () => FocusWatch } {
  const queryClient = useQueryClient();
  const current = useRef<Watching | null>(null);
  // Ger effekten en körning när svaret landat, även om inget annat i skärmen råkar ändras.
  const [, setLandedCount] = useState(0);

  const stopCurrent = () => {
    current.current?.stopListening();
    current.current = null;
  };

  const begin = (): FocusWatch => {
    stopCurrent();
    const watching: Watching = { focused: document.activeElement, landed: false, stopListening: () => {} };
    const onFocusIn = (event: FocusEvent) => { watching.focused = event.target as Element | null; };
    document.addEventListener('focusin', onFocusIn, true);
    watching.stopListening = () => document.removeEventListener('focusin', onFocusIn, true);
    current.current = watching;
    return {
      landed: () => {
        if (current.current !== watching) return;
        watching.landed = true;
        setLandedCount((count) => count + 1);
      },
      stop: () => { if (current.current === watching) stopCurrent(); },
    };
  };

  // Efter varje ritning: svaret har landat, och är det fokuserade elementet borta ur dokumentet (fokus ligger då på <body>) får bekräftelsen fokus. Är inget hämtat om längre är det inget
  // mer som kan ta bort kortet, och bevakningen är slut. Utan beroendelista eftersom det som avgör (DOM, omhämtningen) inte är state; kortet försvinner i en ritning, som kör effekten.
  useEffect(() => {
    const watching = current.current;
    if (!watching?.landed) return;
    // Fokus följs med `focusin`, så ett element som inte längre finns är det senaste som hade fokus, och ingenting har tagit över det sedan dess.
    if (watching.focused !== null && !watching.focused.isConnected) {
      (confirmationElement() ?? duelsPageTarget())?.focus();
      stopCurrent();
    } else if (queryClient.isFetching({ queryKey: CHALLENGES_QUERY_KEY }) === 0) {
      stopCurrent();
    }
  });

  // Skärmen försvinner: ingen lyssnare ska bli kvar.
  useEffect(() => () => {
    current.current?.stopListening();
    current.current = null;
  }, []);

  return { begin };
}
