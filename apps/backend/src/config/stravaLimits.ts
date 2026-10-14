// Strava's limits for the app. Source: the app's settings in Strava, checked 2026-10-07 and confirmed by the owner 2026-10-13
// (ADR 010 decision 9). They are per app, not per user. Athlete capacity: 999.
// Total (reads + writes): 600 per 15 min and 6 000 per day. It does not bind: every call except the token refresh is a read.
export const STRAVA_READ_LIMIT_15_MIN = 300; // reads per 15 min (binds)
export const STRAVA_READ_LIMIT_DAILY = 3000; // reads per day (binds)
// About 70 % of the read limit. The webhook worker pauses at this usage and leaves the rest to polling and manual sync.
export const WEBHOOK_SOFT_LIMIT_15_MIN = 210;
export const WEBHOOK_SOFT_LIMIT_DAILY = 2100;
