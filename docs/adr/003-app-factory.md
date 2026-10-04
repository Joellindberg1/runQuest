# 003. App-factory: all HTTP-wiring på ett ställe

## Status
Godkänd av ägaren 2026-10-04 (Fas 2-paketet)

## Kontext
Backenden har två Express-uppsättningar som glidit isär (STATE.md zon 3):

- `apps/backend/src/server.ts` (det som bygger och startar i produktion):
  helmet, CORS med allowlist (`CORS_ORIGIN`, fallback `https://www.runquest.dev`,
  `credentials: true`, tillåten request utan Origin), `express.json()`,
  request-logg, `/health`, `/api` (med endpoint-lista), nio routers, 404,
  env-validering, `listen`, SIGINT-hantering och scheduler-start (endast
  `NODE_ENV==='production'`).
- `apps/backend/src/app.ts` (importeras bara av de 5 route-testfilerna): öppen
  `cors()`, ingen request-logg, egen routelista, enklare `/api`-svar. Filens
  egen kommentar ("imported by server.ts") stämmer inte — ingen importerar den
  från `server.ts`.
- Följden: produktionens CORS, middleware-ordning och routemontering är
  otestade, och wiringen har glidit isär två gånger — en ny router kan läggas
  till på ena stället och glömmas på det andra (tester grönt, prod 404 — eller
  tvärtom).
- Befintliga ADR:er: ingen berör detta. ADR 001 (teststrategi) kräver
  route-/wiring-tester mot den riktiga wiringen, vilket detta möjliggör.

## Beslut
1. **`apps/backend/src/app.ts` exporterar `createApp()`** som bygger Express-
   appen med ALL http-wiring, i denna ordning:
   `helmet` -> CORS (allowlist från `process.env.CORS_ORIGIN`
   kommaseparerad, fallback `https://www.runquest.dev`, request utan Origin
   tillåts, `credentials: true`) -> `express.json()` -> request-logg (via
   `utils/logger`) -> `GET /health` -> `GET /api` (prod-versionens
   endpoint-lista; superset av testversionen) -> alla routers -> 404-hanterare
   (samma svarsform som i dag).
2. **Routerlistan är EN deklarativ tabell i `app.ts`**
   (`[['/api/auth', authRoutes], ...]`, nio poster) som loopas. Det är enda
   stället en ny router läggs till.
3. **`server.ts` behåller allt som inte är http-wiring:** `dotenv`-laddning,
   env-validering och `process.exit(1)` vid saknade variabler, `listen`
   (`0.0.0.0`), felhantering av `server.on('error')`, SIGINT, och
   scheduler-start vid `NODE_ENV==='production'`. Den importerar `{ createApp }`
   och anropar den EFTER `dotenv.config()` och valideringen, så att
   `CORS_ORIGIN` ur `.env` gäller lokalt (CORS läses vid `createApp()`-anrop,
   aldrig vid modulladdning).
4. **Testerna importerar appen som i dag:** `app.ts` behåller en
   default-export, `export default createApp()`, så de 5 befintliga
   testfilerna fungerar oförändrade. (Instansen byggs vid import; i `server.ts`
   används den inte — den anropar `createApp()` själv. Kostnaden är en extra,
   oanvänd app-instans vid uppstart; routrarna är modul-singletons och kan
   monteras i flera appar.) `server.ts` slutar `export default app`
   (ingen importerar den).
5. **Wiring-tester läggs till** (supertest mot `createApp()`), obligatoriska
   i samma PR: (a) varje prefix i routertabellen svarar 401/400 — inte 404 —
   utan token (fångar glömd montering); (b) CORS: tillåten origin får
   `access-control-allow-origin`, okänd origin får inte, request utan Origin
   passerar, `CORS_ORIGIN` med flera värden respekteras; (c) 404-formen;
   (d) `/health` och `/api`.
6. **Utanför detta beslut:** schedulerns idempotens/tidszon/start-villkor
   (egen ADR), global felhanterare och enhetlig svarsform (egen ADR),
   SIGTERM-hantering vid Railway-deploy (hör till scheduler-ADR:n).

## Alternativ som övervägts
- **Ta bort `app.ts` och låt testerna importera `server.ts`** — bortvalt:
  `server.ts` har sidoeffekter vid import (env-validering med
  `process.exit`, `listen`, scheduler), vilket gör det oimportabelt i test.
- **Låt `createApp` ta alla beroenden som argument (full DI, inkl. en
  `corsOrigins`-parameter)** — övervägt: renare, men fler rörliga delar för
  en app med nio routers och en enda konfigurationskälla (env). Valt: env
  läses i factory-funktionen vid anrop; en `options`-parameter kan läggas till
  när ett test faktiskt behöver åsidosätta något.
- **Behålla två filer och synka manuellt / en lint-regel** — bortvalt: det är
  exakt det som har glidit isär två gånger; dubbel wiring är roten, inte
  disciplinen.
- **Öppen CORS i test, allowlist i prod (nuläget)** — bortvalt: testerna
  bevisar då ingenting om den faktiska CORS-policyn, som är en
  säkerhetsgräns (publik frontend-origin, `credentials: true`).

## Konsekvenser
- **Inga nya externa tjänster, ingen kostnad, ingen databas, ingen ny data.**
  Ingen ändring av vad som exponeras utåt utom att `/api`-svaret blir
  detsamma i alla miljöer.
- **Beteendeförändring i test (avsiktlig):** testerna kör nu med prod-CORS
  (allowlist) och request-logg. supertest skickar ingen Origin, så befintliga
  tester påverkas inte; logg-brus i testutdata hanteras av Builder (t.ex.
  tyst logger vid `NODE_ENV==='test'`).
- **Positivt:** en wiring, en routertabell; ny route kan inte längre glömmas
  på ena stället; prod-CORS och middleware-ordning blir testade; zon 3 i
  STATE.md stängs.
- **Risker:** (1) Prod-uppstart ändras — verifieras före deploy genom att
  bygget (`esbuild src/server.ts`) körs lokalt och `/health` + CORS-preflight
  mot `https://www.runquest.dev`-origin provas (Produkt-läge: rök före
  deploy). (2) Env läses vid `createApp()`-anrop — en framtida import av
  `app.ts` före `dotenv.config()` ger tom CORS-konfiguration för default-
  instansen (påverkar inte produktion, där `server.ts` anropar själv).
  (3) `buildcommand` bundlar `server.ts`; `app.ts` kommer med via importen —
  inget ändras i `railway.toml`.
- **Arkitekturdiagram:** ingen ändring — intern uppdelning av backend-
  komponenten, inga nya komponenter eller kopplingar (diagrammet är på
  komponentnivå).
- **STATE.md-ändringar att föreslå:** zon 3 ("Två backend-entrypoints")
  stryks eller omformuleras till "löst av ADR 003" när implementerad;
  konventionen "ny route läggs i routertabellen i `app.ts`".

## Revisit-triggers
- Ett test behöver åsidosätta CORS/logg/konfiguration -> inför
  `createApp(options)`.
- Fler än en Express-app behövs (t.ex. separat admin-/webhook-tjänst).
- Schedulern bryts ut till egen process/tjänst (scheduler-ADR) -> `server.ts`
  delas i `web` och `worker`.
- Global felhanterare/enhetlig svarsform införs -> den hör hemma i
  `createApp()`.
