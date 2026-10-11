/**
 * Utmaningstecknets geometri: vimpel (vertikal, svalstjärt) i viewBox 0 0 26 32 — ur designens `pennant()` (runquest-badges.js).
 * Delas av Board (leaderboard/BoardParts) och Duels (challenges/TierRibbon) så att tecknet aldrig kan driva mellan vyerna.
 * SVG-data, inte stil: färg, mått och dämpning bor i respektive feature-CSS.
 */
export const PENNANT_VIEW_BOX = '0 0 26 32';
export const PENNANT_PATH = 'M1.5 1.5 H24.5 V30.5 L13 23.5 L1.5 30.5 Z';
export const PENNANT_TEXT_X = 13;
export const PENNANT_TEXT_Y = 16.5;
