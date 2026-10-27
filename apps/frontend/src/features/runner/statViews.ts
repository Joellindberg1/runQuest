// `?view=` på Runner card (ADR 006): distance (default) · streak · fun. Consistency-heatmapen hör till profilens panel — runner-sidans
// panel i prototypen faller tillbaka på Distance för den. Listan bor här och inte i panelen eftersom värden (RunnerCard) äger `?view=`.
export const STAT_VIEWS = ['distance', 'streak', 'fun'] as const;
export type StatView = (typeof STAT_VIEWS)[number];
export const DEFAULT_STAT_VIEW: StatView = 'distance';
