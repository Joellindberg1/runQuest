// Flikarna i profil-popupen (ADR 006 addendum 2026-10-26, beslut 3): overview (default) · journey · titles · badges. Tillståndet är komponenttillstånd i popupen, aldrig `?view=`
// (till skillnad från statflikarna i `statViews.ts` som sidan lägger i adressen), och nollställs därför vid varje öppning.
export const POPUP_SECTIONS = ['overview', 'journey', 'titles', 'badges'] as const;
export type PopupSection = (typeof POPUP_SECTIONS)[number];
export const DEFAULT_POPUP_SECTION: PopupSection = 'overview';
