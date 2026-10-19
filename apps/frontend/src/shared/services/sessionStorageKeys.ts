/**
 * Lagringsnycklarna för sessionen. `backendApi` skriver och läser dem; sessionstipset i landing.html (landing-entry/sessionHint.ts) läser samma två
 * för att veta om besökaren är inloggad innan någon JS har laddats. En källa, så de två inte kan glida isär (ADR 006, addendum 2026-10-19, punkt 4).
 */
export const SESSION_TOKEN_KEY = 'runquest_token';
export const SESSION_USER_KEY = 'runquest_user';
