# landing-entry — lean ingång för `/`

Landningens egen ingång (ADR 006, addendum 2026-10-19). `landing.html` + `landing-main.tsx` ger exakt `/` en förrenderad landning som hydreras av en liten kodmängd; fullappen (`index.html` + `main.tsx` + `routes.tsx`) är orörd i sin struktur. Före S6 (Caddy-regeln) serveras `landing.html` inte, men den byggs och testas.

## Delar

- `LandingApp` — hela trädet: `AppProviders`, en router som skickas in (`BrowserRouter` i webbläsaren, `ServerRouter` vid bygget) och `LandingRoutes`. Stagingbannern (bara i ett stagingbygge) ligger **utanför** providers.
- `LandingRoutes` — `/` och `/login` (samma element på samma plats: landningen ommonteras inte när dialogen öppnas), `/legal` (lazy, egen Suspense-gräns) och `*` = överlämning till fullappen.
- `LandingIndex` — `pages/Index` för den lean ingången: utloggad = landningen (+ lazy inloggningsdialog på `/login`), inloggad = `AppHandoff`. Förhämtar dialogen på pekare/fokus/beröring mot Sign in (fångat på dokumentet; landningsfeaturen får inte känna till `features/auth`).
- `AppHandoff` / `UnknownAddressHandoff` — renderar appens laddningsvy (`app-shell/RoutePending`) i samma rendering som det gamla försvinner och laddar sedan om sidan på målet (`leaveForApp` = `location.replace`). `signedInTarget` ger målet: som fullappens `Index`, men aldrig `/` (annars laddar sidan om sig själv i en loop).
- `loginDialog.ts` + `LoginDialogChunk.tsx` — dialogen som egen chunk. Den bär skalets överlagerlager (`.rq-scrim`, `.rq-modal`) genom att importera `app-shell.css`; lagret ska inte ligga i första besökets CSS (testat i `landingBuild.test.ts`).
- `hydrateLanding` — `hydrateRoot` med `onRecoverableError` som loggar (`log.warn`) men inte rapporterar. `../landing-ssr.tsx` är serversidan och `../../scripts/prerender-landing.mjs` bygget.

## Regler som kostade något att lära sig

- **Ingen Suspense-gräns runt landningen.** Varje gräns i den förrenderade HTML:en hydreras för sig, senare än resten, och ändrar en provider sitt värde före det (AuthProvider släpper `loading` i en effekt direkt efter första hydreringen, ThemeProvider läser temat) klientrenderar React om hela gränsen: synligt byte och omstartade animationer. `hydrateLanding.test.tsx` fäller om en gräns hamnar runt `/` eller bannern hamnar under en provider.
- **Inloggad = ingen `<Navigate>`.** Den renderar null i en commit innan navigeringen sker, och containern vore tom. `LandingIndex` byter landningen mot laddningsvyn i samma commit (`LandingApp.test.tsx` läser DOM:en efter varje commit).
- **Bygget faller hellre än levererar ett trasigt förrenderat bygge:** saknad markör (`<!--app-landing-->`, `<!--app-loader-->`) eller markör utanför `#root`, en modul som rör `window` vid import, ett kastat renderingsfel.
