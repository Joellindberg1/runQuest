# Admin Feature — `/admin`

XP-inställningar, medlemmar, titlar, säkerhet och väntelista (`?view=xp|users|titles|security|waitlist`, `useViewParam`). Bara för administratörer (`AdminRoute` skickar andra till /board).
Web Prototypens Admin; mobilprototypen saknar sidan, så mobil är härledd. `pages/AdminPage.tsx` är tunn. Sidan ersätts senare av XP-paket — ingen ny funktion här, bara design.

## Struktur

- **components/** — `AdminScreen` (flikar + all data via `useAdminData`), `XpSettingsPanel`, `MembersPanel`, `TitlesPanel`, `SecurityPanel`, `WaitlistPanel` (läsvy över GET /api/admin/waitlist: antal, e-post · datum, "Showing the latest N of M" när listan är kapad; ingen åtgärd)
- **adminModel.ts** — `XP_GROUPS` (fälten och vilka som är redigerbara), `multiplierRows`, `findSettingsProblem`, `memberMeta`
- **waitlistModel.ts** — texterna: `signupCountText`, `shownLimitText`, `signupDateText` (Stockholm-dag via eventsFormat + logFormat)
- **hooks/useAdminWaitlist.ts** — React Query över `backendApi.getAdminWaitlist` (fel kastas, så felkortet visas i stället för en tom lista)
- **hooks/useAdminData.ts** — oförändrad logik (läsning, Save, medlemmar); toasts ersatta av `notices` per del (`settings|users|security`) och läsfel som flaggor
- `admin.css` — mått (`--rq-admin-*`) i temafilen, sektion 1.31

## Regler värda att komma ihåg

- **Save är låst tills inställningarna OCH trappan lästs in** (`settingsLoaded` → `canSave`, testat i `useAdminData.test.tsx` och `AdminScreen.test.tsx`). Medan det laddas visas en
  stadion-oval, misslyckas det ett felkort med Retry (`reloadSettings`) — fälten visar aldrig standardvärden som om de vore riktiga. Knappen står kvar, låst, med förklaring.
- **Backendens validering (multiplikator 1–9.99, högst två decimaler) vaktas av servern**; dess 400-text visas ordagrant i alert-regionen. Fältet får `aria-invalid` utanför intervallet
  och `step=0.01`. Ett tomt fält stoppas före anropet (`findSettingsProblem`) i stället för att skickas som `null`.
- **"Min run date" är skrivskyddat:** Save skickade det aldrig (se docs/open-assumptions.md, "Restsidor"). Prototypens "Min km for streak" är borttaget — streaken har ingen distansgräns; `min_run_distance` heter "Min km for base XP" eftersom det bara styr bas-XP.
- **Streak-trappan** visas i stigande dagordning; nytt steg läggs till i listan men sparas först vid Save.
- **Titlar** läser verkliga titlar ur databasen (delar rader med Playbook via `features/titles/titleRules`); "Refresh title leaderboards" är oförändrad funktion.
- **Säkerhet:** adminlösenordet är fortfarande inte kopplat till backend (svaret säger det); Strava-backfillen visar summa + rad per användare, fel i alert.
- **En guldknapp per vy:** Save all settings · Add member · (Titles: ingen) · Change password.
