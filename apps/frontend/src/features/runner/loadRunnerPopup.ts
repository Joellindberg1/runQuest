/**
 * Popupens chunk (ADR 006 addendum 2026-10-26, beslut 1). Ett enda importanrop delas av `React.lazy` i `pages/RunnerPage.tsx` och av förladdningen
 * (`usePreloadRunnerPopup`), så att webbläsaren hämtar chunken en gång och bådas anrop får samma modul.
 */
export const loadRunnerPopup = () => import('./components/RunnerPopup');
