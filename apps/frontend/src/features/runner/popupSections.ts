import type { StatView } from '@/features/profile/statsModel';

// Flikarna i profil-popupen (ADR 006 addendum 2026-10-26, beslut 3): overview (default) · journey · titles · badges. Tillståndet är komponenttillstånd i popupen, aldrig `?view=`
// (till skillnad från statflikarna som sidorna lägger i adressen), och nollställs därför vid varje öppning.
export const POPUP_SECTIONS = ['overview', 'journey', 'titles', 'badges'] as const;
export type PopupSection = (typeof POPUP_SECTIONS)[number];
export const DEFAULT_POPUP_SECTION: PopupSection = 'overview';

// Overview-växlingen återanvänder profilens statistikvyer: aktivitetskartan heter `consistency` där och visas som "Activity" här. Popupen börjar på kartan (profilens egen standard är Distance).
export const DEFAULT_OVERVIEW_VIEW: StatView = 'consistency';
