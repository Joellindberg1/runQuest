/** Board-sidans delvyer (`?view=`, ADR 006 beslut 3). Delas av sidan och av laddningsgaten, som bara väntar på podiets dekor i Season-vyn. */
export const BOARD_VIEWS = ['season', 'week', 'streaks'] as const;
export type BoardView = (typeof BOARD_VIEWS)[number];
export const DEFAULT_BOARD_VIEW: BoardView = 'season';
