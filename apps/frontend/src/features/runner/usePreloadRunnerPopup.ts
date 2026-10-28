import { useEffect } from 'react';
import { loadRunnerPopup } from './loadRunnerPopup';

/** Attributet som varje element som öppnar en löpare bär (samma som `findRunnerElement`). */
const RUNNER_ROW_SELECTOR = '[data-runner-id]';

/**
 * Hämtar popupens chunk redan när pekaren går över en löparrad eller raden får tangentbordsfokus, så att klicket sällan möter en kall chunk. Ett enda ställe för alla ytor:
 * lyssnarna sitter på dokumentet och väljer med `data-runner-id`, och `pointerover` och `focusin` bubblar (`pointerenter` och `focus` gör det inte). Första träffen räcker, därefter
 * tas lyssnarna bort. Hämtningen är bara en förhoppning: felar den (offline) försöker `React.lazy` på nytt när användaren öppnar popupen, och felet visas då.
 */
export function usePreloadRunnerPopup(): void {
  useEffect(() => {
    const stop = () => {
      document.removeEventListener('pointerover', preload);
      document.removeEventListener('focusin', preload);
    };
    function preload(event: Event) {
      if (!(event.target instanceof Element) || !event.target.closest(RUNNER_ROW_SELECTOR)) return;
      stop();
      loadRunnerPopup().catch(() => undefined);
    }
    document.addEventListener('pointerover', preload);
    document.addEventListener('focusin', preload);
    return stop;
  }, []);
}
