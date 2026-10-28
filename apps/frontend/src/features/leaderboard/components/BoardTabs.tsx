import { useRef, type SyntheticEvent } from 'react';
import { ViewTabs, type ViewTab } from '@/shared/components/ViewTabs';
import { tabId } from '@/shared/components/viewTabIds';
import { useTabRowFade } from '@/shared/hooks/useTabRowFade';
import type { BoardView } from '../boardViews';

/** Prefixet för flikarnas och panelens id:n; sidan pekar panelen tillbaka på den valda fliken med samma prefix. */
export const BOARD_TABS_ID_PREFIX = 'board';

interface BoardTabsProps {
  tabs: readonly ViewTab<BoardView>[];
  view: BoardView;
  onChange: (next: BoardView) => void;
  /** Pekaren går över en flik eller en flik får tangentbordsfokus: användaren är på väg dit. Sidan förladdar vyns chunk på den signalen. */
  onIntent: (view: BoardView) => void;
}

/**
 * Standings flikrad. Fyra flikar ryms inte på 320 px: raden scrollar i sidled i sin egen yta (RUN-387-mönstret i board.css) och tonas ut mot den kant som har fler flikar bortom
 * sig (`useTabRowFade`). Kantfaden är bara markup runt raden (data-attributen på omslaget); raden är fortfarande den enda tablisten. En komponent per plats i sidan (rubrikraden på
 * desktop, under rubriken på mobil), så att måtten följer raden när sidan byter läge.
 */
export function BoardTabs({ tabs, view, onChange, onIntent }: BoardTabsProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const fade = useTabRowFade(wrapRef, view, tabs.length);

  // Händelserna bubblar från flikknappen (ViewTabs har ingen egen krok per flik).
  const reportIntent = (event: SyntheticEvent) => {
    const tab = (event.target as HTMLElement).closest('[role="tab"]');
    const heading = tabs.find((candidate) => tab?.id === tabId(BOARD_TABS_ID_PREFIX, candidate.key));
    if (heading) onIntent(heading.key);
  };

  return (
    <div ref={wrapRef} className="rq-board__tabs-wrap" data-fade-start={String(fade.start)} data-fade-end={String(fade.end)} onPointerOver={reportIntent} onFocus={reportIntent}>
      <ViewTabs label="Standings view" tabs={tabs} value={view} onChange={onChange} idPrefix={BOARD_TABS_ID_PREFIX} className="rq-board__tabs" />
    </div>
  );
}
