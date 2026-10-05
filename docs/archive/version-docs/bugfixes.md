# RunQuest — Bug Fixes

Samlad lista över alla identifierade buggar och hur de löstes. Minor/triviala buggar dokumenteras inte här.

---

## BUG-001 — Tom databas efter titeloppdateringar

**Severity:** High
**Introduced:** 0.1.0
**Fixed in:** 0.1.0
**Area:** Backend — Title System

### Problem
`title_leaderboard`-tabellen tömdes ibland helt efter att en användares data uppdaterats, vilket innebar att inga titlar visades i appen.

### Orsak
`titleTriggerSystem.cjs` rensade hela tabellen **innan** nya data beräknats. Om ett fel uppstod under beräkningen (t.ex. schemaproblem, serverkrasch) förblev tabellen tom istället för att behålla de gamla värdena.

Ytterligare schema-fel förvärrade problemet:
- Systemet försökte använda kolumnerna `created_at`/`updated_at` som inte finns i databasen
- Systemet använde `total_distance` istället för det korrekta kolumnnamnet `total_km`

### Lösning
1. **Atomisk operation** — beräkna alla nya entries *först*, rensa sedan tabellen och fyll i allt i ett steg
2. **Schema-korrigering** — ändrade till `earned_at` och `total_km` för att matcha verkligt databasschema
3. **Säkerhetsventil** — `DISABLE_AUTO_TITLE_TRIGGERS=true` i `.env` stänger av automatiska triggers vid behov
4. **Förbättrad felhantering** — bättre logging och error handling för att undvika partial failures

### Berörda filer
- `apps/backend/titleTriggerSystem.cjs`
- `apps/backend/src/services/titleLeaderboardService.ts`
- `apps/backend/src/utils/calculateUserTotals.ts`

---

## BUG-002 — Session fastnar vid utgången token

**Severity:** Medium
**Introduced:** 0.1.0
**Fixed in:** 0.1.1
**Area:** Frontend — Authentication

### Problem
När en användare var inloggad men inte besökt appen under en längre period löpte JWT-token ut. Nästa gång användaren öppnade appen fick de ett felmeddelande som "user not found" eller liknande och kunde inte göra något. Enda lösningen var att manuellt rensa cookies/localStorage i webbläsaren.

### Orsak
Frontenden hanterade inte 401-svar från API:et. Utlöpt token → API svarar 401 → frontenden visade ett generiskt felmeddelande utan att städa upp den gamla sessionen eller navigera till inloggningssidan.

### Lösning
Lade till 401-detektering i alla autentiserade API-anrop. Vid 401:
1. `localStorage` rensas automatiskt (token + användardata)
2. React-state sätts till `null` för användaren
3. `App.tsx` renderar inloggningssidan automatiskt (ingen manuell redirect krävs)

En central hjälpmetod `handleUnauthorized()` i `BackendApiService` hanterar detta konsekvent för alla anrop.

### Berörda filer
- `apps/frontend/src/shared/services/backendApi.ts`
- `apps/frontend/src/providers/AuthProvider.tsx`
