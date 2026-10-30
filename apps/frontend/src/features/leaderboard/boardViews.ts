import { showPositionTab } from './positionTab';

/** Board-sidans delvyer (`?view=`, ADR 006 beslut 3). Delas av sidan och av laddningsgaten, som bara väntar på podiets dekor i Season-vyn. */
export const BOARD_VIEWS = ['season', 'week', 'streaks', 'position'] as const;
export type BoardView = (typeof BOARD_VIEWS)[number];
export const DEFAULT_BOARD_VIEW: BoardView = 'season';

/** De värden `?view=` får anta för en grupp av den här storleken: `position` i en grupp på en faller tillbaka på standardvyn, som vilket okänt värde som helst. */
export function boardViewsFor(memberCount: number): readonly BoardView[] {
  return showPositionTab(memberCount) ? BOARD_VIEWS : BOARD_VIEWS.filter((view) => view !== 'position');
}
