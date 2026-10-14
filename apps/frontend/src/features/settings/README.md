# Settings Feature — `/settings`

Strava-koppling, lösenordsbyte och senaste synk. Web Prototypens Settings (Strava-kort · Password | Latest sync); mobilprototypen saknar sidan, så mobil är
härledd (allt i en kolumn). `pages/SettingsPage.tsx` är tunn.

## Struktur

- **components/** — `SettingsScreen` (datakoppling, laddning/fel), `StravaCard`, `StravaConsentBlock` (samtycket i Strava-kortet), `PasswordCard`, `SyncCard`
- **stravaConsent.ts** — bär den godkända samtyckesversionen över OAuth-omdirigeringen (sessionStorage, `rq.strava.consent`)
- **settingsModel.ts** — `buildStravaCard` (tillstånd, chip, tre celler, regler, token-förnyelse), `buildSyncRow`, `validatePasswordChange` (ren logik, testad)
- **hooks/** — `useStravaData` (shared Strava-queries + `useStravaConfig`), `useStravaActions` (koppla via OAuth-fönster, koppla om, synka nu), `usePasswordChange`,
  `useUserSettings` (ADR 011: query `['settings','user']` bara inloggad; optimistisk växling per nyckel, skrivningarna går i ordning; ett fel återställer nyckeln, visas som `error` för `role="alert"` och läser om tillståndet
  eftersom ett 500 kan ha skrivit ändå; serverns hela tillstånd skrivs in efter svaret; nyhetsflödet invalideras efter lyckad skrivning; ett laddningsfel ger defaults + `isError`)
- `settings.css` — mått (`--rq-settings-*`) i temafilen, sektion 1.30

## Regler värda att komma ihåg

- **Strava-queries delas** med skalets Right now och Logs Strava-rad (`shared/hooks/useStravaQueries`): en koppling som görs här syns överallt direkt.
- **Kortet har tre tillstånd** med kantfärg + statuschip: Connected (grön, live-prick), Expired (röd; "Reconnect Strava" öppnar bara Strava-fönstret, callbackens upsert skriver över tokens och statusen förblir Expired tills kopplingen lyckats), Not connected (neutral).
  Kortet väntar in last-sync-hämtningen så cellerna inte blinkar "Unknown". Statusen går inte att läsa → felkort med Retry; lösenordet fungerar ändå.
- **OAuth-flödet är oförändrat:** fönstret öppnas mot Strava, `public/strava-popup.html` skickar `{code, error}` med postMessage, bara samma ursprung accepteras.
  Blockerat fönster, avbruten auktorisering och serverfel är text i kortets alert-region.
- **Samtycket (ADR 010 beslut 12, D4):** utan koppling och vid utgången koppling visar kortet de fyra punkterna (`STRAVA_CONSENT_KEY_POINTS` i shared: vad som importeras, borttagning inom 48 h med omräkning, "Disconnect" raderar och går inte att ångra, synken kan pausas) som en synlig lista, ordagrant ur källan, och hela Strava-avsnittet (`getDataPolicySection('strava')`, aldrig en kopia) hopfällt bakom "Read the full text" (`details`, ingen scrollruta). Rutan "I've read this and agree that RunQuest imports my Strava runs as described" och länken till /legal#privacy står direkt efter; Connect/Reconnect är `disabled` tills rutan är ikryssad och `connect(agreed)` gör ingenting utan bock. Bocken nollas när kortets tillstånd byter. Klicket sparar `STRAVA_CONSENT_VERSION` i sessionStorage, callbacken läser och tar bort den (även utan inloggning) och skickar den som `consent_version` (saknas den skickas ingen nyckel och servern svarar 400 "Consent required", som visas med uppmaning att ladda om sidan). Appen använder inget OAuth-`state`, därför sessionStorage. Den som redan är ansluten ser samma text hopfälld som information (ingen ruta, D4), placerad ovanför åtgärderna så att fler knappar i kortet inte flyttar den.
- **Pausa eller koppla bort (ADR 010 beslut 7.5–7.6, frame P1 + ägarbeslut 2026-10-14):** medan synken kör har kortet "Pause or disconnect" som öppnar `StravaConnectionDialog`: valet (en mening per val: "Pause sync" / "Disconnect…") och därefter en SEPARAT bekräftelse (`role="alertdialog"` på Radix Dialog; AlertDialog-paketet är inte installerat), med hela förklaringen, "cannot be undone" och knappen "Disconnect and delete N runs". Första fokus är "Keep my connection"; Esc stänger, ett klick bredvid stänger inte bekräftelsen. Ett pausat kort har två knappar: "Turn sync back on" (PUT `sync-paused` false) och "Disconnect" (rakt till bekräftelsen); "Pause or disconnect" och "Sync now" visas då inte. Chippet "Paused" är neutralt bläck med statisk prick (inte silver, Stylelint förbjuder `--rq-silver`/`--rq-rank-` i settings.css).
  - **Texter:** `stravaConnectionCopy.ts`. DELAT ordagrant ur `STRAVA_CONSENT_KEY_POINTS`: varningen "Disconnecting cannot be undone: …". UI-text som integritetstexten också säger ordagrant (prövas mot `getDataPolicySection('strava')`): "Runs you delete or make private on Strava are still removed here" och "The runs and tokens are deleted even if Strava does not answer." Återkallandet hos Strava är ett försök ("RunQuest asks Strava to revoke its access"), aldrig en garanti (ADR 7.4.2).
  - **N rundor:** `countStravaRuns` över `users-with-runs` (samma cache som skalet och Profile), bara den inloggades rundor med `source === 'strava'`. Så länge rundorna inte är lästa (laddar/felade) är antalet `null` och knappen säger "Disconnect and delete all Strava runs", aldrig "0". Hämtas bara för en levande koppling.
  - **Regioner:** bekräftelser (Sync paused / back on / disconnected) i kortets permanenta `Strava status`; dialogens fel i dialogens egen `Strava connection error` (alert, dialogen står kvar öppen). Efter en lyckad åtgärd går fokus till kortets rubrik (`tabindex=-1`); vid avbrott tillbaka till knappen som öppnade dialogen.
  - **Omhämtning:** pause = `['strava']`; resume och disconnect = `['strava']` + `invalidateAfterRunChange` (användare/rundor, Board, event, titlar, utmaningar, Pack News, badges); resume gör en andra omhämtning efter `RESUME_FOLLOW_UP_MS` eftersom servern hämtar luckan i bakgrunden. Klienten antar aldrig att rundorna är borta förrän de lästs om.
- **"Sync now"** syns bara för "Joel Lindberg" (som före omritningen); efter en synk hämtas alla aktiva queries om.
- **Lösenord:** valideringen körs vid inlämning, felet står bredvid fältet (`aria-invalid` + `aria-describedby`), fokus går till första felet, inget anrop görs. Bekräftelse och
  serverfel i `Password`-regionerna; att skriva efter en bekräftelse tar bort den.
- **Statusregioner, inga toasts:** `shared/components/form/FormNotices` (permanenta `role=status`/`role=alert`, namngivna per formulär).
- **En guldknapp:** Change password. Strava-knapparna (även Connect) är sekundära; sidan har en guldknapp i taget, testat i `SettingsScreen.test.tsx`.
