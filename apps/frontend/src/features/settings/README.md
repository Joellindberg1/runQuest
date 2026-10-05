# Settings Feature — `/settings`

Strava-koppling, lösenordsbyte och senaste synk. Web Prototypens Settings (Strava-kort · Password | Latest sync); mobilprototypen saknar sidan, så mobil är
härledd (allt i en kolumn). `pages/SettingsPage.tsx` är tunn.

## Struktur

- **components/** — `SettingsScreen` (datakoppling, laddning/fel), `StravaCard`, `PasswordCard`, `SyncCard`
- **settingsModel.ts** — `buildStravaCard` (tillstånd, chip, tre celler, regler, token-förnyelse), `buildSyncRow`, `validatePasswordChange` (ren logik, testad)
- **hooks/** — `useStravaData` (shared Strava-queries + `useStravaConfig`), `useStravaActions` (koppla via OAuth-fönster, koppla om, synka nu), `usePasswordChange`
- `settings.css` — mått (`--rq-settings-*`) i temafilen, sektion 1.30

## Regler värda att komma ihåg

- **Strava-queries delas** med skalets Right now och Logs Strava-rad (`shared/hooks/useStravaQueries`): en koppling som görs här syns överallt direkt.
- **Kortet har tre tillstånd** med kantfärg + statuschip: Connected (grön, live-prick), Expired (röd, "Reconnect Strava" rensar de gamla tokens först), Not connected (neutral).
  Kortet väntar in last-sync-hämtningen så cellerna inte blinkar "Unknown". Statusen går inte att läsa → felkort med Retry; lösenordet fungerar ändå.
- **OAuth-flödet är oförändrat:** fönstret öppnas mot Strava, `public/strava-popup.html` skickar `{code, error}` med postMessage, bara samma ursprung accepteras.
  Blockerat fönster, avbruten auktorisering och serverfel är text i kortets alert-region.
- **"Sync now"** syns bara för "Joel Lindberg" (som före omritningen); efter en synk hämtas alla aktiva queries om.
- **Lösenord:** valideringen körs vid inlämning, felet står bredvid fältet (`aria-invalid` + `aria-describedby`), fokus går till första felet, inget anrop görs. Bekräftelse och
  serverfel i `Password`-regionerna; att skriva efter en bekräftelse tar bort den.
- **Statusregioner, inga toasts:** `shared/components/form/FormNotices` (permanenta `role=status`/`role=alert`, namngivna per formulär).
- **En guldknapp:** Change password. Strava-knapparna är sekundära.
