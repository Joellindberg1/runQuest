import { useCallback, useMemo, useReducer, useRef } from 'react';
import { MAX_SHOWCASE } from '@runquest/shared';
import { cleanShowcase, sameShowcase, toggleShowcase, type BadgeRow } from '../badgeModel';
import { useSaveShowcase } from './useBadgeQueries';

export type ShowcaseSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface ShowcaseDraft {
  /** Utkastet: det som visas som valt. Städat mot det jag äger, i valordning (platsen på Board-kortet), högst MAX_SHOWCASE. */
  draft: string[];
  /** Det sparade valet i sparad ordning (serierna med `displayPosition`). */
  saved: string[];
  /** Utkastet skiljer sig från det sparade (ordningen räknas). */
  dirty: boolean;
  /** Utkastet har MAX_SHOWCASE serier: övriga växlare är då avstängda (aria-disabled). */
  full: boolean;
  status: ShowcaseSaveStatus;
  /** Sparandet pågår: växlare och SAVE DISPLAY ignorerar klick. */
  saving: boolean;
  /** Senaste ändringen som mening för en `aria-live`-region ("{Serie} added to display, position N."). Tom efter spara. */
  announcement: string;
  /** 1-baserad plats i utkastet, null = inte vald. */
  positionOf: (series: string) => number | null;
  /** Lägger till sist (om det finns plats och serien är ägd) eller tar bort. Ingen omsortering. Ignoreras medan sparandet pågår. */
  toggle: (series: string) => void;
  /** Sparar utkastet. Avvisas aldrig: ett fel blir `status: 'error'` och utkastet ligger kvar. Gör ingenting om inget är osparat eller sparandet pågår. */
  save: () => Promise<void>;
}

interface DraftState {
  /** null = följ det sparade (inget utkast). */
  picked: string[] | null;
  status: ShowcaseSaveStatus;
  announcement: string;
}

type DraftAction =
  | { type: 'toggle'; series: string; name: string; owned: readonly string[]; saved: readonly string[] }
  | { type: 'saveStart' }
  | { type: 'saved' }
  | { type: 'failed' }
  | { type: 'settle' };

const INITIAL: DraftState = { picked: null, status: 'idle', announcement: '' };

// Reducern är ren och tar `owned`/`saved` med i handlingen: flera växlingar i samma tick komponeras i ordning mot det senaste utkastet
// (en stängd-över `draft` hade låtit den andra klicken skriva över den första), och bekräftelsen räknas ur samma resultat som utkastet.
function reduce(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case 'toggle': {
      if (state.status === 'saving') return state;
      const current = cleanShowcase(state.picked ?? action.saved, action.owned);
      const next = toggleShowcase(current, action.owned, action.series);
      if (sameShowcase(next, current)) return state;
      const announcement = next.includes(action.series)
        ? `${action.name} added to display, position ${next.indexOf(action.series) + 1}.`
        : `${action.name} removed from display.`;
      return { picked: next, status: 'idle', announcement };
    }
    case 'saveStart':
      return { ...state, status: 'saving' };
    // Lyckat: följ det sparade igen (hooken useSaveShowcase har redan skrivit serverns värde i samlingen).
    case 'saved':
      return { picked: null, status: 'saved', announcement: '' };
    // Fel: utkastet ligger kvar (useSaveShowcase återställer samlingen, inte utkastet).
    case 'failed':
      return { ...state, status: 'error' };
    // Felet rensas (RETRY när inget längre är osparat); utkastet rörs inte.
    case 'settle':
      return state.status === 'error' ? { ...state, status: 'idle' } : state;
  }
}

/**
 * Utkastet för visade badges på /badges (spec F9.7): logiken ur den tidigare väljaren (RUN-129, borttagen i RUN-150), utan UI. `rows` är `buildCollection`-raderna (de bär vad jag äger och det sparade
 * valet), `userId` går till `useSaveShowcase` som skriver optimistiskt, återställer vid fel och invaliderar samlingen + gruppen.
 *
 * `picked` null betyder "följ det sparade": en omhämtning mitt i ett utkast rör alltså inget utkast som redan ändrats, men uppdaterar `dirty` mot det nya sparade.
 * Utkastet städas vid varje rendering mot det jag äger, så en serie som försvunnit (nedgradering) varken syns eller skickas.
 */
export function useShowcaseDraft(rows: readonly BadgeRow[], userId: string | undefined): ShowcaseDraft {
  const [state, dispatch] = useReducer(reduce, INITIAL);
  const { save: saveShowcase, isPending } = useSaveShowcase(userId);
  const inFlight = useRef(false);

  const owned = useMemo(() => rows.filter((row) => row.earned).map((row) => row.series), [rows]);
  const saved = useMemo(
    () => rows.filter((row) => row.displayPosition !== null).sort((a, b) => (a.displayPosition as number) - (b.displayPosition as number)).map((row) => row.series),
    [rows],
  );
  const names = useMemo(() => new Map(rows.map((row) => [row.series, row.name])), [rows]);
  const draft = useMemo(() => cleanShowcase(state.picked ?? saved, owned), [state.picked, saved, owned]);
  const dirty = !sameShowcase(draft, saved);
  // Ett fel som inte längre har något att göra: PUT lyckades men svaret gick förlorat, och refetchen gav sparat = utkast. Visas som 'idle', inte 'saved':
  // vi vet inte att det var vårt anrop som gick igenom (det kan vara en annan enhet), så vi påstår ingen bekräftelse — knappen säger redan SAVED när inget är osparat.
  const status = !dirty && state.status === 'error' ? 'idle' : state.status;

  const toggle = useCallback(
    (series: string) => dispatch({ type: 'toggle', series, name: names.get(series) ?? series, owned, saved }),
    [names, owned, saved],
  );

  const save = useCallback(async () => {
    // Ref-spärren gäller även ett andra anrop i samma tick, innan `status` hunnit renderas.
    if (inFlight.current) return;
    if (!dirty) {
      // RETRY efter ett förlorat svar: servern har redan utkastet (sparat = utkast), så det finns inget att skicka — bara felet att rensa.
      if (state.status === 'error') dispatch({ type: 'settle' });
      return;
    }
    inFlight.current = true;
    dispatch({ type: 'saveStart' });
    try {
      await saveShowcase(draft);
      dispatch({ type: 'saved' });
    } catch {
      dispatch({ type: 'failed' });
    } finally {
      inFlight.current = false;
    }
  }, [dirty, draft, saveShowcase, state.status]);

  const positionOf = useCallback((series: string) => (draft.includes(series) ? draft.indexOf(series) + 1 : null), [draft]);

  return {
    draft,
    saved,
    dirty,
    full: draft.length >= MAX_SHOWCASE,
    status,
    saving: state.status === 'saving' || isPending,
    announcement: state.announcement,
    positionOf,
    toggle,
    save,
  };
}
