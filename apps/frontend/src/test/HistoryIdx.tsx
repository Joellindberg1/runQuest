import { useLayoutEffect, useRef } from 'react';
import { NavigationType, useLocation, useNavigationType } from 'react-router-dom';

/**
 * MemoryRouter har ingen riktig webbläsarhistorik, och koden som skiljer ett steg bakåt från en ny post läser `window.history.state.idx` (som BrowserRouter skriver).
 * Den här komponenten skriver samma index åt MemoryRouter: +1 för PUSH, −1 för POP (proven går bara bakåt) och oförändrat för REPLACE. Den ritas före det som ska läsa indexet
 * (layout-effekten körs före alla passiva effekter) och nollställs av `resetHistoryIdx` efter provet.
 */
export function HistoryIdx({ start }: { start: number }) {
  const location = useLocation();
  const type = useNavigationType();
  const idx = useRef(start);
  const seen = useRef<typeof location | null>(null);

  useLayoutEffect(() => {
    if (seen.current !== null && seen.current !== location) {
      if (type === NavigationType.Push) idx.current += 1;
      else if (type === NavigationType.Pop) idx.current -= 1;
    }
    seen.current = location;
    window.history.replaceState({ idx: idx.current }, '');
  }, [location, type]);

  return null;
}

export const resetHistoryIdx = (): void => {
  window.history.replaceState(null, '');
};
