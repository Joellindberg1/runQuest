# 006. Navigering och skärmstruktur: riktiga routes, ett app-skal, responsiv variant

## Status
Godkänd av ägaren 2026-10-04 (redesign-beslut 1–5)
Addendum 2026-10-13 (RUN-200): renderingsstrategi för den publika `/`, föreslaget, se längst ner.

## Kontext
Redesignen (docs/design/redesign-plan.md, designprojektet i
docs/design/claude-design/) ersätter hela navigationsmodellen. Verifierat i
koden 2026-10-04:

- **Routing idag.** `App.tsx` har `BrowserRouter` + `Routes` med flata routes
  (`/`, `/admin`, `/settings`, `/features`, `/challenges`, `/playbook`,
  `/events`, `/preview`, `/preview/challenges`). Utloggad användare får
  `LoginPage` på alla vägar utom `/preview*`. `pages/Index.tsx` på `/` växlar
  innehåll med `?tab=` (`leaderboard` som default, `titles`, `profile`,
  `log-run`) och monterar en `FeatureTour` per flik.
- **Skalet monteras per sida.** Varje sida (Index, ChallengesPage, EventsPage,
  PlaybookPage, FeaturesPage, SettingsPage, AdminPage, de två preview-
  sidorna) lindar sig själv i `<AppLayout groupName=…>` (Sidebar + TopBar) och
  hämtar gruppnamnet själv. Skalet monteras alltså om vid varje routebyte, och
  `?tab=`-länkar och `/challenges` är olika slags adresser till samma skal.
  `Sidebar.useActiveTab()` blandar pathname och `?tab=`.
- **Profilkortet är en modal utan adress.** `UserProfileModalProvider` +
  `useUserProfileModal().openProfile(id)` (4 anropsplatser: `Leaderboard`,
  `RunHistoryGroup`, `ActiveChallengeWidget`, `OngoingChallengeCard`) monterar
  `UserProfileModal` globalt. Går inte att länka till, back-knappen stänger
  inte den.
- **Onboarding hänger på layouten.** `onboardingSteps.ts` (tour
  `onboarding_v1`) pekar på `data-tour="sidebar-*"`-ankare i `Sidebar.tsx`;
  `sidebarBridge` öppnar mobil-lådan imperativt före touren. Sidspecifika
  turer (`featureTourSteps.ts`: events, challenges, leaderboard, titles,
  profile) pekar på ankare inne i respektive sida (`leaderboard-card`,
  `titles-my-titles-tab`, `challenges-tokens`, `events-*`, `profile-*` …).
- **Brytpunkt vid beslutet:** 768 px (Tailwind `md`, `useIsMobile`), sidebar
  `w-[60vw] md:w-[15%]`. [RÄTTAT 2026-10-12 (RUN-220): beskriver läget före
  redesignen. `useIsMobile` och shadcn-sidebaren är borttagna (RUN-217); skalet
  väljer med `useIsDesktop` (1024 px), se beslut 5.]
- **Designen** (App Prototype = mobil, Web Prototype = desktop): mobil har
  femflikars bottenbar Ranks / Titles / +New / Duels / You, header med
  gruppnamn, kalenderikon (events), klockikon (news) och avatarmeny; "Right
  now"-pills under headern; Events och Pack News nås från headern. Desktop har
  vänster sidnavigering (Game: Leaderboard/Titles/Challenges/Events · You:
  Profile/Log Runs · RunQuest: Playbook/Feature & Version/FAQ/Bug Report),
  "Right now"-panel i sidnavigeringen, header med klock-popover (360 px, "See
  all pack news") och avatarmeny (Settings/Admin/Log out). Runner card är en
  skärm på mobil men en 860 px-overlay på desktop.
- Skärmarna byggs inkrementvis och går live löpande (Railway deployar vid
  push till `main`, oberoende av CI — STATE.md). Skalet och routingen måste
  därför gå att leverera FÖRE skärmarna är omgjorda.

Relaterade ADR:er: **001** (teststrategi — frontend har 0 tester; routing/
skal blir den första frontend-sviten, RTL är redan beslutat), **004**
(frontend läser data via hooks — oförändrat). Ingen ADR ersätts. Ägarbeslut
1–5 i redesign-planen är ramen (särskilt 4: landing = hårdkodad dummy-data,
"Create your pack" väntar på multi-grupp).

## Beslut
1. **Router.** Behåll `BrowserRouter` + deklarativa `<Routes>`
   (react-router-dom v6, redan installerat). Ingen data-router, inga
   `loader`s: servertillstånd ägs av TanStack Query (STATE.md). Routeträdet
   byggs med layout-routes:
   `RequireAuth` (utloggad → `/login?next=<path>`) → `AppShell` (ett skal,
   `<Outlet/>`) → sidor. Skalet monteras EN gång och överlever routebyten;
   gruppnamn, "Right now"-data och olästa news hämtas i skalet, inte i sidorna.
   Utloggat träd: `/` = Landing (inkrement 10; tills dess `LoginPage`),
   `/login` = `LoginPage` (ersatt 2026-10-11: Landing + inloggningsdialog, se addendum), `/preview*` oförändrat tills respektive
   preview-sida raderas (flaggad som skuld: de är gamla designskisser).
2. **Routetabell** (paths definieras en gång i `src/paths.ts`, t.ex.
   `paths.runner(id)`; inga path-strängar utspridda):

   | Path | Skärm | Flik/vy (`?view=`) | Nås från |
   |---|---|---|---|
   | `/` | redirect → `/board` (se beslut 7 för gamla `?tab=`) | | |
   | `/board` | Ranks | `season` (default) · `week` · `streaks` | bottenbar Ranks, sidnav Leaderboard |
   | `/titles` | Titles | `all` (default) · `mine` · `unclaimed` | bottenbar Titles |
   | `/duels` | Duels (challenges) | `live` (default) · `standings` · `rules` · `history` | bottenbar Duels, sidnav Challenges |
   | `/events` | Events (öppna/kommande/vecka/historik; historik `?page=`) | | header-kalender (mobil), sidnav (desktop) |
   | `/news` | Pack News | filter via `?type=` (kommaseparerat) | klock-popover "See all", avatar |
   | `/log` | Log runs (formulär + group history) | `form` · `group` | +New → Log a run, sidnav Log Runs |
   | `/profile` | Din profil | `distance` · `streak` · `fun` · `consistency` | bottenbar You, sidnav Profile |
   | `/runner/:id` | Runner card | | alla namn/avatarer i appen |
   | `/playbook` | Playbook | kapitel `?view=` | avatarmeny (mobil), sidnav (desktop) |
   | `/features` | Feature & Version | `shipped` · `working` · `releases` | avatarmeny (mobil), sidnav (desktop) |
   | `/settings` | Settings | | avatarmeny |
   | `/admin` | Admin (kvar: `isAdmin`-grind, annars redirect `/board`) | | avatarmeny (endast admin) |
   | `*` | NotFound (inne i skalet) | | |

   Bottenbarens aktiva flik härleds ur pathname: Ranks = `/board`,
   `/runner/*`, `/events`; Titles = `/titles`; Duels = `/duels`; You =
   `/profile`, `/log`, `/news`, `/playbook`, `/features`, `/settings`,
   `/admin` (samma mappning som prototypens `backMap`).
3. **Delvyer = sökparametern `?view=`**, aldrig nya path-segment och aldrig
   `?tab=` (namnet reserveras för legacy-redirecten). En liten hook
   `useViewParam(allowed, default)` läser/skriver parametern med
   `replace: true`, och okänt värde faller tillbaka till default. Delvyn
   blir därmed delbar och back-vänlig utan en route per flik. `PageTabs` ersätts
   av chip-flikar (`ViewTabs`, `.rq-filter`: vald = guld 14 %/50 %) över hooken —
   prototypens faktiska flikmönster för Board (App Prototype `boardTabs`,
   Web Prototype `boardTabs`) — och tas bort när sista användaren är konverterad.
4. **Overlays (ingen egen route).**
   - **+New-sheet** (Log a run / Send a challenge): skal-tillstånd, öppnas av
     mittenknappen i bottenbaren (mobil) och av "Log Runs"/"Send challenge" i
     desktop-skalet. "Log a run" navigerar till `/log`; "Send a challenge"
     navigerar till `/duels` och öppnar send-sheeten (som prototypen).
   - **Send-challenge-sheet:** styrs av sökparametrarna `?send=1` (öppnar
     sheeten; flagga) och `&opponent=<userId>` (valfri förvald motståndare;
     sheeten validerar att den tillhör gruppen) och monteras i
     skalet så att Runner card-knappen "Challenge" fungerar från vilken
     skärm som helst. Parametern gör att back-knappen stänger sheeten och att
     den överlever omladdning.
   - **Klock-popover:** klockikonen i headern öppnar en popover med de
     senaste news (data: `GET /news?limit=5`, ADR 008) och länk "See all pack
     news" till `/news`. Kalenderikonen (endast mobil) navigerar direkt till
     `/events`.
   - **Avatarmeny:** mobil: Playbook · Feature & Version · Settings · Admin
     (endast admin) · Log out. Desktop: Settings · Admin (endast admin) ·
     Log out (Playbook/Feature & Version ligger i sidnavigeringen). Log out
     anropar `logout()` och går till `/login` (ändrat 2026-10-11: går till `/`, se addendum). Notifikationsinställningarna i
     Web Prototype ("Settings → Notifications") byggs INTE nu (ägarbeslut 5:
     news är display-only; inställningar hör till den framtida notis-/
     realtids-ADR:n).
5. **Ett skal, två varianter, en brytpunkt.**
   - **Brytpunkt 1024 px (Tailwind `lg`).** < 1024 = mobilvarianten
     (App Prototype är facit; surfplatta i stående läge får mobilskalet med
     centrerad maxbredd ~640 px); ≥ 1024 = desktopvarianten (Web Prototype är
     facit). Skälet till att flytta från dagens 768: desktopens tabeller
     (Board har sju kolumner, Titles/Events tvåkolumnslayout) och sidnav
     behöver bredd; mellan 768 och 1023 vore det trångt.
   - `AppShell` väljer med JS (`useIsDesktop()` = `matchMedia('(min-width:
     1024px)')`) mellan `MobileShell` (header + `BottomBar`) och
     `DesktopShell` (`SideNav` + header). **Exakt EN variant finns i DOM** —
     inte CSS-döljning — så att `data-tour`-ankare är unika, fokusordning/ARIA
     inte dubbleras och queries inte körs dubbelt. `useIsMobile`
     (shadcn-sidebarens hook) användes aldrig för skal-val och är sedan RUN-217
     borttagen tillsammans med shadcn-sidebaren; `useIsDesktop` är den enda
     brytpunktshooken i skalet.
   - **Skärmarna är samma komponenter i båda lägena.** En route-komponent per
     skärm som anpassar sig med `lg:`-klasser; datahooks delas. Endast tre
     ställen får grena i JS: (a) skalet, (b) Runner card (sida på mobil,
     overlay på desktop — beslut 6), (c) sheet på mobil vs dialog på desktop
     för +New/Send. Där DOM-strukturen skiljer sig fundamentalt (Board:
     podium+kort vs tabell) får skärmen ha två presentationskomponenter, men
     dataladdning och logik ligger i den gemensamma skärmen — aldrig
     `MobileX`/`DesktopX` med varsin hämtning. Ljust bronstema (Web
     Prototype-variant) är en temafråga (inkrement 0/Designern), inte en
     routingfråga.
6. **Runner card = egen route `/runner/:id`** (ersätter `UserProfileModal`).
   - Mobil: helskärmssida (egen route i skalet, bottenbar kvar, aktiv flik
     Ranks).
   - Desktop: samma route renderas som overlay ovanpå föregående sida
     ("background location"-mönstret: navigering inifrån appen skickar
     `state.background = location`; skalet renderar bakgrundssidan och
     overlayn). Direktladdning/omladdning/delad länk (ingen
     `background`) renderar den som en vanlig sida. Esc/✕/back stänger
     (`navigate(-1)` med fallback `/board` när historiken saknas).
   - `/runner/<eget id>` redirectar till `/profile`. Okänt/ogiltigt id →
     NotFound i skalet. Kräver att användaren finns i anroparens grupp (data
     kommer från `users-with-runs`, som redan är gruppavgränsad).
   - `UserProfileModal`, `UserProfileModalProvider` och
     `userProfileModalContext` raderas; de fyra anropsplatserna byter till
     `useOpenRunner()` (tunn hook över `navigate(paths.runner(id), {state})`).
7. **Gamla adresser (redirects, permanent):** en `LegacyRedirects`-komponent
   på `/` (läser `?tab=`) och en route på `/challenges`:

   | Gammal | Ny |
   |---|---|
   | `/` eller `/?tab=leaderboard` | `/board` |
   | `/?tab=titles` | `/titles` |
   | `/?tab=profile` | `/profile` |
   | `/?tab=log-run` | `/log` |
   | `/?tab=<okänt>` | `/board` |
   | `/challenges` | `/duels` |

   Alla redirects är `replace` och bevarar övriga sökparametrar utom `tab`.
   `/events`, `/playbook`, `/features`, `/settings`, `/admin` behåller sina
   paths. Bokmärken är den enda kända konsumenten, så redirects är billiga
   försäkringar; de får tas bort i en framtida städning utan ADR.
8. **Onboarding-ankare (policy).**
   - Ankare i skalet äger skalet och är layoutoberoende till namnet:
     `nav-ranks`, `nav-titles`, `nav-new`, `nav-duels`, `nav-you` (bottenbar
     eller sidnav-motsvarighet: `nav-ranks` = Leaderboard, `nav-duels` =
     Challenges, `nav-you` = Profile), `nav-events` (endast desktop-sidnav),
     `header-events` (endast mobil), `header-news`, `header-avatar`,
     `right-now-strava`. Eftersom exakt en skalvariant finns i DOM är varje
     ankare unikt. Tour-steg som kan landa på olika element per variant
     använder en kommaseparerad selektor (`[data-tour="nav-events"],
     [data-tour="header-events"]`).
   - `onboarding_v1` skrivs om i **inkrement 1** (skal+routing) mot dessa
     ankare; `sidebarBridge` raderas (ingen lådnavigering på mobil
     längre; `OnboardingOrchestrator` tappar sina `beforeStart/afterEnd`).
     Strava-steget pekar på `right-now-strava` (Strava-kortet i sidebaren
     ersätts av "Right now"-raden).
   - Sidspecifika turer (`TOUR_*`) uppdateras i **samma PR som skärmen de
     tillhör byggs om** (inkrement 2 Board, 3 Runner, 4 Titles, 5 Duels, 6
     Events, 8 Profile). Slug (`tour_leaderboard_v1` …) behålls om stegens
     innebörd är densamma (användare som redan sett den ser den inte igen);
     ändras innebörden materiellt bumpas slug till `_v2` i samma PR.
   - **Vakt:** ett statiskt test läser `featureTourSteps.ts`/
     `onboardingSteps.ts`, plockar ut alla `data-tour`-namn och kräver att
     varje namn förekommer som `data-tour="…"` i någon komponentkälla. Fångar
     ankare som försvinner när en skärm byggs om.
9. **Skalkomponenter som ersätts/raderas** (vid inkrement 1): `AppLayout`,
   `Sidebar`, `TopBar`, `ProfileMenu` (→ `AvatarMenu`), `GlobalSidebarWidget`,
   `EventWidget`, `SidebarActivityWidget` (→ "Right now"-pills/-panel, data ur
   befintliga endpoints: streak ur `users-with-runs`, event ur `/events`,
   duell ur `/challenges/my`, Strava ur `/strava/last-sync`; streak-deadline
   härleds i klient — STATE/plan inkrement 1), `sidebarBridge`.
   Sidorna slutar anropa `AppLayout` och returnerar bara sitt innehåll.
10. **Leverans i etapper (strangler).** Routeträdet, `AppShell`, redirects,
    ankare och tester levereras i **inkrement 1** med BEFINTLIGT sidinnehåll
    monterat på de nya routes (gamla `Leaderboard` på `/board`,
    `TitleSystem` på `/titles`, `features/challenges`-innehållet på
    `/duels`, `UserProfile` på `/profile`, `RunLogger` på `/log`, den gamla
    modalens innehåll som sida på `/runner/:id`). `/news` registreras i
    inkrement 1 men klockikonen förblir inaktiv ("coming soon", som i dag)
    och routen visar en tom-vy tills inkrement 9. Routerna är därmed stabila
    från inkrement 1; senare inkrement byter bara sidinnehåll.
11. **Kodstruktur och kodsplittring.** Sidor ligger kvar tunna i `pages/`
    (`BoardPage`, `TitlesPage`, `DuelsPage` (ersätter `pages/ChallengesPage`),
    `EventsPage`, `NewsPage`, `LogPage`, `ProfilePage`, `RunnerPage`, …);
    skalet i `src/app-shell/` (`AppShell`, `MobileShell`, `DesktopShell`,
    `BottomBar`, `SideNav`, `AvatarMenu`, `NotificationsPopover`,
    `NewSheet`, `RightNow`); routeträdet i `src/routes.tsx`. Sällan besökta
    sidor (`admin`, `playbook`, `features`, `settings`) laddas med
    `React.lazy`; skalet och huvudflödena är eagerly laddade.
12. **Tester (ADR 001).** Första frontend-sviten (Vitest + RTL +
    `MemoryRouter`): (a) tabelldrivet redirect-test (alla rader i beslut 7);
    (b) aktiv-flik-mappning per pathname; (c) `useViewParam` (default, okänt
    värde, replace); (d) skalval: exakt en variant renderas vid 1023/1024 px
    (mockad `matchMedia`); (e) `/runner/<eget id>` → `/profile`;
    (f) tour-ankarvakten (beslut 8); (g) avatarmenyn visar Admin endast för
    admin.

## Alternativ som övervägts
- **Behålla `?tab=` och lägga bottenbaren ovanpå.** Bortvalt: ingen
  per-skärm historik/delbara länkar, Runner card kan inte bli route, och
  skalet monteras fortfarande om per sida. Det är dagens problem.
- **Data-router (`createBrowserRouter` + loaders).** Bortvalt: loaders
  duplicerar TanStack Query som redan är servertillståndets ägare och
  appen har ingen SSR; migreringen skulle röra alla sidor utan att lösa något
  redesignen behöver.
- **Annat routerbibliotek (TanStack Router, typad filbaserad routing).**
  Bortvalt: nytt beroende och migrering för en app med ~12 routes och en
  ensam utvecklare; en liten `paths.ts` ger det mesta av typsäkerheten.
- **Path-segment för delvyer (`/board/week`).** Bortvalt: dubbelt så många
  routes, aktiv-flik-logik och redirects för 3–4 vyer per skärm; appen är
  privat så indexerbara URL:er saknar värde. `?view=` räcker.
- **Rendera båda skalen och dölja med CSS (`hidden lg:flex`).** Bortvalt:
  `data-tour`-ankare blir dubbla (driver.js väljer första träffen, ibland det
  dolda), dold DOM fångar fokus/skärmläsare och hooks körs dubbelt.
- **Brytpunkt 768 (nuvarande `md`).** Bortvalt, se beslut 5; omprövas om
  testning visar att surfplattor i stående läge är vanliga och mobilskalet
  känns trångt/glest.
- **Runner card som modal på båda (nuläget).** Bortvalt av ägaren (route) och
  eftersom modalen inte går att länka till; overlay-på-desktop bevarar
  designens utseende utan att offra adressen.
- **Separata `Mobile*`/`Desktop*`-skärmar med egen datahämtning.** Bortvalt:
  två sanningar per skärm, dubblerade tester, och "samma komponenter,
  responsiv variant" är uttalad riktning.

## Konsekvenser
- **Inga nya externa tjänster, ingen kostnad, ingen databas, ingen ny data,
  ingen känslig data.** Ren frontendändring; inga backendkrav från denna ADR
  (news/endpoints ligger i ADR 007/008).
- **Positivt:** skalet monteras en gång (färre omhämtningar, ingen
  flimmer vid sidbyte); varje skärm och Runner card har en delbar adress
  och fungerande back-knapp; tour-ankare får en uttalad ägare och en vakt;
  `?tab=`-routingen och sidebarBridge-hacket försvinner; första
  frontendtesterna etableras.
- **Negativt/risker:**
  1. Paths blir publikt kontrakt (bokmärken). Mildras av redirects i beslut 7.
  2. Railway deployar frontend på push oberoende av CI och routingen rör
     varje sida. **Förutsättning att verifiera i release-preview:** att
     hosten ger SPA-fallback för djupa länkar (befintliga `/events` m.fl. fungerar
     i prod, men `/runner/<id>` och `/board` direktladdade ska provas).
     `railway.toml` har bara `buildCommand`.
  3. Overlay-routing på desktop (background location) är ett mönster som
     lätt blir fel vid direktladdning/omladdning — därför test (f)/(e)
     och explicit fallbackbeslut i beslut 6.
  4. Strangler-leveransen betyder att gamla skärminnehåll lever i det nya
     skalet under en period (visuell blandning); accepterat, ordningen
     följer redesign-planens inkrement.
  5. Frontend `tsc`/eslint är blockerande (ADR 001) — alla nya filer måste
     vara rena från start.
  6. `useIsDesktop` ger ett första-render-flimmer om värdet är `undefined`
     (som den gamla `useIsMobile`, nu borttagen); skalet ska rendera
     `null`/skeleton tills `matchMedia` lästs, inte gissa.
- **Arkitekturdiagram:** ingen ändring — frontend är en SPA-komponent i
  diagrammet och inga runtime-komponenter eller kopplingar läggs till.
- **STATE.md-ändringar att föreslå:** (1) ADR-index: rad 006. (2) Stack/
  Konventioner: "Routing: react-router v6 deklarativ; layout-routes
  `RequireAuth → AppShell`; paths i `src/paths.ts`; delvyer via `?view=`;
  brytpunkt 1024 px, exakt en skalvariant i DOM". (3) Kritiskt flöde 1
  (login → JWT) rök-testet utökas: "deep link `/runner/:id` och `/board`
  direktladdade när inloggad respektive utloggad (→ `/login?next=`)".
  (4) Zon 10 (stora filer): `PlaybookPage`/`EventsPage` påverkas inte av
  denna ADR men skalraderingen minskar yta. (5) Design-skuld/onboarding:
  "ankare ägs av skalet (ADR 006 beslut 8)".

## Revisit-triggers
- Surfplatte-/bredfönsteranvändning visar att 1024 är fel (för trångt eller
  för glest) → flytta brytpunkten eller inför en tredje (surfplatte)variant.
- Fler än ~3 delvyer per skärm behöver egna adresser (t.ex. delbara
  Playbook-kapitel som sökmotor-/dokumentationsmål) → path-segment för just
  den skärmen.
- Realtid/notiser (ADR 008:s framtid) kräver att overlay/popover-tillståndet
  delas mellan flikar eller att skalet prenumererar på en ström →
  skal-tillståndet flyttas till en provider.
- Multi-grupp (roadmap) → gruppbyte hör hemma i headern ("chevron" bredvid
  gruppnamnet finns redan i designen) och kan kräva `/g/:groupId`-prefix.
- Landing-inkrementet (10) blir publik/SEO-relevant → server-/statisk
  rendering av `/` omprövas.

## Addendum 2026-10-11 (RUN-145, ägarbeslut): login som popup, utloggning till Landing
Ändrar beslut 1 (utloggat träd) och avatarmenyns "Log out" (beslut 4). Resten av ADR:n gäller oförändrad.

1. **Login är en dialog över Landing, inte en egen sida.** `LoginPage` är borta. `/login` renderar samma `Index`-element som `/` (Landing) med `LoginDialog` (`features/auth`, Radix Dialog + skalets `.rq-modal`/`.rq-scrim`) monterad ovanpå. Båda routerna renderar samma komponent på samma plats i trädet, så Landing ommonteras inte när dialogen öppnas eller stängs.
2. **Adressen speglar läget: `/login` (inte `?login=1`).** Skälen: (a) `/login?next=<path>` finns redan som kontrakt (RequireAuth, befintliga länkar, rök-testet i Konsekvenser) och behöver inte byta form; (b) ett sökparameter-läge hade krävt att `next` och flaggan samexisterar i samma query på `/`, där gamla `?tab=`-adresser redan tolkas; (c) en egen path gör Back-semantiken entydig. Sign in-knappen är en vanlig `<Link>` med router-state (`FROM_LANDING_STATE`): knappen pushar `/login`, så Back stänger dialogen; ✕/Esc/scrim gör samma sak (ett steg bakåt när dialogen öppnades från Landing, annars `replace` till `/`, och `next` släpps).
3. **Djuplänkar och skyddade sidor.** `/login` och `/login?next=/titles` ger Landing med dialogen öppen; efter inloggning går man till `next` (`resolveNextPath`, bara interna adresser, aldrig en öppen redirect — oförändrat). `RequireAuth` skickar fortfarande utloggade på en skyddad route till `/login?next=<path>`, som nu alltså betyder Landing + dialog + bevarad `next`.
4. **"Log out" → `/`, utan dialog och utan `next`.** AvatarMenu navigerar (`replace`) till `/` i samma händelse som `logout()`; de batchas till en rendering, så `RequireAuth` hinner aldrig skicka till `/login?next=`. Ordningen mellan de två anropen spelar ingen roll; kravet är att `logout()` nollställer användaren synkront i samma händelse (inget `setTimeout`, ingen `await` före `setUser`). Annars hinner en rendering emellan med användaren kvar på `/` (Index → `/board`) eller adressen kvar på den skyddade sidan (RequireAuth → `/login?next=`). `App.logout.test.tsx` faller om `logout()` skjuts upp eller görs asynkront före `setUser` (verifierat med mutationer).
5. **401 mitt i sessionen → `/login?next=<sidan>` (Landing med dialogen öppen).** Valt framför "Landing utan dialog": användaren fick sin session avbruten mot sin vilja och ska komma tillbaka dit hen var. Det är samma väg som RequireAuth redan tog (`onUnauthorized` nollställer användaren; RUN-143:s `queryClient.clear()` är oförändrad). Ingen loop: `clear()` startar ingen omhämtning, och den utloggade vyn gör inga anrop.
6. **Gränsen mot "Landing gör inga anrop" (ägarbeslut 4).** Landing-FEATUREN (`features/landing`) är oförändrat publik: inga anrop, ingen `useAuth`, ingen import ur `features/auth` (vaktat i `guards.test.ts`). Den enda kopplingen är att Sign in-länken navigerar. Dialogen, som anropar `AuthProvider.login`, monteras av sidan (`pages/Index`), inte av featuren. Utloggad gör `/` och `/login` därmed fortfarande inga backend-anrop förrän man skickar in formuläret.
8. **`next` mot kontrolltecken.** `resolveNextPath` avvisar alla kontrolltecken (U+0000–U+001F, U+007F) och kräver att adressen tolkas till samma origin som sidan (`new URL(next, origin).origin`); fallback `/board`. Webbläsarens URL-tolkning tar bort tab/LF/CR, så `/<tab>/evil.com` blev `//evil.com` och gav SecurityError i `replaceState` (vit skärm). Testat i `legacyRedirects.test.ts` och genom riktig `<App/>` (`App.login.test.tsx`).
9. **Dialogen går alltid att lämna.** ✕, Esc, scrim och Back fungerar även under pågående inloggning (`backendApi.login` har ingen timeout, så en spärr hade gett en död ✕ utan signal). Försöket avbryts då (`AbortSignal` från `useLoginForm` till `AuthProvider.login`): ett svar som kommer efter att dialogen lämnats kastas — token rensas, ingen användare sätts, ingen cache rensas, inget fel visas — så Landing står kvar och ingen navigering till `/board` sker mot användarens vilja.
10. **Designspråk.** EN guldknapp per vy: i dialogen är "Sign In" den enda aktiva (Landings knapp ligger bakom scrimmen, mörkad och dold för hjälpmedel). Måttet `--rq-login-w` återanvänds; `--rq-login-logo-w` och `--rq-login-glow-*` är borttagna ur temafilen (logotypen och gloden finns på Landing bakom dialogen).

## Addendum 2026-10-13 (RUN-200): renderingsstrategi för den publika landningen `/`
Besvarar revisit-triggern "Landing-inkrementet blir publik/SEO-relevant → server-/statisk rendering av `/` omprövas". Beslut 1–12 och addendum 2026-10-11 gäller oförändrade: `/` och `/login` förblir en klientrenderad SPA-route. Status: föreslaget, väntar på ägarens godkännande. Ingen ADR ersätts. Arkitekturdiagrammet ändras inte (inga nya runtime-komponenter eller kopplingar).

### Beslut
**Alternativ (a): statisk metadata i `apps/frontend/index.html`.** Titel, description, Open Graph, Twitter-kort, canonical, ikoner/manifest-länkar och en kort `<noscript>`-text. Ingen prerender, ingen SSR, ingen ändring i `Caddyfile`, Vite-konfigen, `main.tsx` eller routern. RUN-205 räcker; ingen följdstory föreslås (se "Revisit" för när (b) tas upp igen).

### Underlag: vad en bot utan JS ser på `/` idag
Verifierat i koden 2026-10-13 (läst: `index.html`, `Caddyfile`, `vite.config.ts`, `main.tsx`, `routes.tsx`, `pages/Index.tsx`, `features/landing`, `scripts/verify-static-serving.sh`; ingen live-förfrågan körd).
- **Vad Caddy serverar.** `/` löses av `try_files {path} {path}.html {path}/index.html /index.html` till `dist/index.html` med `Cache-Control: no-cache`. Exakt samma fil serveras för varje SPA-adress (`/board`, `/runner/x`, `/login`, okända adresser).
- **Vad filen innehåller.** `<title>Run Quest</title>`, `description` "Gamification for running", `og:title` "run-rank-reign" (ett gammalt internt namn, inte varumärket), `og:description`, `og:type`. Ingen `og:image`, `og:url`, `og:site_name`, inga `twitter:*`, ingen canonical, inga ikoner, inget manifest, inget `theme-color`, ingen `<noscript>`. Kroppen är ett tomt `<div id="root">` plus modulscriptet.
- **Följden.** Delningsbotar (Facebook, LinkedIn, Slack, iMessage) läser bara `<head>` och kör inte JS: en delad länk blir "run-rank-reign / Gamification for running" utan bild. Google renderar JS i en andra, fördröjd våg och ser då landningen, men en bot som inte renderar ser ingen text alls.
- **Saknade filer ger mjuk 404.** Eftersom reservfallet är `index.html` svarar `/favicon.ico`, `/apple-touch-icon.png`, `/sitemap.xml` och `/site.webmanifest` med 200 och HTML tills riktiga filer finns i `apps/frontend/public/`. Idag finns där bara `robots.txt` och `strava-popup.html`.
- **Appen är tom tills JS laddats även för människor.** `App.tsx` visar `TrackLoader` medan sessionen läses (`loading`), därefter laddas den lazy `Index`-chunken (RUN-219) bakom `RoutePending`.
- **Landningen gör inget anrop idag** (`guards.test.ts`, `LandingScreen.test.tsx`). RUN-208 lägger ett (de sanna siffrorna), se konsekvenser.

### Bedömning
| | Vad det ger | Vad det kostar |
|---|---|---|
| **(a) Statisk meta + noscript** | Delningsförhandsvisning fungerar överallt (det är head-metadata som läses). Google indexerar ändå den renderade sidan. Nollkostnad, noll nya beroenden, inga nya buildsteg. | Kroppstexten finns inte i rå-HTML för en bot som inte kör JS; `<noscript>` täcker rubrik och ingress men inte hela sidan. |
| **(b) Prerender vid bygget** | Fullt innehåll i rå-HTML, snabbare första målning. | Se nedan: kräver headless-webbläsare i Railpack-bygget eller ett separat SSR-bygge, en separat HTML-fil plus Caddy-regel, och rör hydrering, RUN-219 och RUN-208. Underhåll utan motsvarande vinst nu. |
| **(c) Hostingnivå** | Botdetektering i Caddy (`User-Agent` → statisk fil) eller tredjepartstjänst (prerender-tjänst) eller flytt till annan host med edge-rendering. | Botdetektering = dubbelt innehåll att underhålla och "dynamic rendering", som Google avråder från. Tjänst eller flytt = återkommande kostnad eller migrering av hosting och domänoppsättning (apex-redirecten, CORS mot `www`), alltså ägarens ja. Railway/Caddy saknar prerender-stöd. |

Varför (b) inte är värt det nu, konkret:
1. **`index.html` är gemensam för alla routes.** Prerenderad landning i den filen skulle blinka upp för inloggade som öppnar `/board`. Det kräver en separat fil (till exempel `landing.html`) och en Caddy-regel för `/` och `/login`, och `verify-static-serving.sh` måste utökas.
2. **Inloggade på `/` skulle se landningen innan `Index` skickar dem vidare** (`Navigate` till `/board`). I dag ser de bara laddaren. Hela gruppens dagliga ingång skulle få en flimmerregress för att tjäna en publik som är en bråkdel av trafiken.
3. **Hydrering krockar med RUN-219.** `Index` är en lazy chunk bakom Suspense och `App` renderar `TrackLoader` före routerträdet; `hydrateRoot` mot prerenderad landning ger mismatch. Antingen görs landningen eager (inloggade betalar för landningskoden och dess CSS igen) eller så ersätter `createRoot` markupen, vilket ger ett synligt byte.
4. **Animationer och uppräkning startar om.** `ArenaTrack` (CSS `offset-path`) och `useCountUp` (börjar på 0) skulle byggas om i DOM:en vid ersättning eller hydrering; en server måste dessutom välja ett värde för uppräkningen (0 eller slutvärde).
5. **De sanna siffrorna går inte att prerendera hederligt.** Antingen fryses byggtidens siffror i HTML (föråldrade tills nästa deploy) eller bygget anropar backenden (byggfel när backenden är nere), eller så prerenderas de påhittade siffrorna, som landningen just ska sluta visa.
6. **Verktygen.** `react-dom/server` mot landningen kräver en SSR-entry och att alla landningsmoduler är fria från `window`/`matchMedia` på modulnivå; en Puppeteer/Playwright-prerender kräver Chromium i Railpack-bygget. Båda ökar byggtid och sköra punkter för en sida som ändras sällan.

### Konsekvenser
- **Kostnad, data, känsligt:** ingen kostnadsdrivande tjänst, ingen databas, ingen extern lagring, inga personuppgifter. Ingen avvikelse (15c).
- **`guards.test.ts`:** oförändrad. Den läser `features/landing/**` och `pages/LandingPage.tsx` som rå text och rör inte `index.html`. Under (b) hade den behövt hantera en SSR-entry.
- **`LandingScreen.test.tsx`:** oförändrad av detta beslut. (RUN-208 ändrar den av egen anledning: testet bevakar `fetch` och förväntar de hårdskrivna siffrorna.)
- **Hydrering:** ingen. `main.tsx` behåller `createRoot` och `App.tsx` sin laddare; inget byte av renderingsläge.
- **Animationer, ArenaTrack, uppräkning:** orörda; de startar när landningen monteras, som idag.
- **Lazy-laddning (RUN-219):** orörd. Inloggade betalar inte för landningskoden. Kostnaden är att en besökare får en vattenfall (`index.html` → entry-chunkar → `Index`-chunken + `landing.css`/`board.css` + typsnitt från Google). Mät först (Lighthouse mobil på `/`) innan något görs; det är en revisit-trigger, inte ett skäl för (b) nu.
- **Caddys cachepolicy:** ingen ändring. `index.html` är `no-cache`, så metaändringar når användarna vid nästa omladdning; `/assets/*` är `immutable` och berörs inte. Filer i `public/` (ikoner, OG-bild, manifest, sitemap) går via catch-all-blocket och blir `no-cache` (revalidering med ETag), vilket är rätt eftersom de inte har hashade namn. Plattformarna cachar länkförhandsvisningar per URL: byt filnamn på OG-bilden vid ändring (eller använd plattformarnas debugger) i stället för att skriva över.
- **RUN-208 (sanna siffror):** hämtningen sker i klienten efter montering och påverkar inte metadata. Därför får `description`, OG-text och `<noscript>` inte innehålla siffror (de skulle bli föråldrade eller falska). RUN-208 äger själv ändringen av ägarbeslut 4 i `guards.test.ts`/ESLint (`LANDING_IMPORTS`).

### Konsekvenser för följdstories
**RUN-205 (meta, OG, favicon, manifest).** Räcker, med dessa bestämningar:
- Alla absoluta URL:er pekar på `https://www.runquest.dev` (appens enda adress; apex skickas 308 till `www`). Hårdkoda; inget Vite-plugin eller miljövariabel behövs (Caddyfile hårdkodar redan domänen).
- `og:title`/`<title>`: ersätt "run-rank-reign"; förslag "RunQuest — Run · Rank · Reign" (copy avgörs i RUN-205). `description` på engelska (sidan är engelsk; `lang="en"` står kvar), ungefär 150 tecken, byggd på h1/ingressen, utan siffror.
- `og:type`, `og:url`, `og:site_name`, `og:image` (+ `width`/`height`/`alt`), `twitter:card=summary_large_image` med titel/description/image. OG-bilden är en PNG/JPG, 1200×630, absolut URL (plattformarna visar inte SVG).
- `canonical` = `https://www.runquest.dev/`. Den ligger i den gemensamma `index.html` och gäller därför medvetet alla SPA-adresser, inklusive `/login`; det är rätt eftersom bara `/` är publik och övriga adresser ligger bakom inloggning.
- Favicon: SVG + `favicon.ico` + `apple-touch-icon` (180 px), `theme-color` från temafilens bakgrund, `site.webmanifest` i `public/`.
- `<noscript>` före `#root`: samma h1 som `LandingHero` plus ett stycke och en rad om att JavaScript behövs. Inga siffror. Inget stilberoende.
- **Test:** ett litet test som läser `index.html` från disk (som `guards.test.ts` läser CSS) och kräver title/description/og:*/twitter:*/canonical, att `og:image` är absolut, och att noscript-rubriken är samma text som h1 i `LandingParts` (driftvakt).
- **Verifiering i `verify-static-serving.sh`:** lägg kontroller för att favicon, manifest och OG-bild svarar 200 med rätt `content-type` (inte HTML). Mjuk 404 är annars osynlig. Kontrollera även `.webmanifest`-typen.

**RUN-206 (robots, sitemap).** Sitemap med en post: `https://www.runquest.dev/`. `robots.txt` finns redan och tillåter allt; lägg till `Sitemap:`-raden (absolut `www`). Överväg `Disallow: /preview` (de publika `/preview*`-sidorna är gamla designskisser med påhittad data och skulle annars hamna i indexet; de delar samma statiska `<head>`, så `noindex` per sida går bara via JS och robots-filen är den enkla vägen tills sidorna raderas). Filerna ska ligga i `public/` (annars mjuk 404, se ovan).

**RUN-207–210 (landningens sektioner).** Eftersom kroppen inte prerenderas:
- Sökbart innehåll som ska nå en icke-renderande bot hör hemma i head och `<noscript>`; sektionerna får vara fullt interaktiva och animerade utan SEO-hänsyn.
- Sektionerna får inte kräva byggtidsdata. Allt som hämtas (RUN-208) hämtas i klienten och måste ha ett tydligt laddnings-/felläge som inte visar påhittade siffror som fakta.
- Rubrikhierarkin (en h1, h2 per sektion) vaktas av `LandingScreen.test.tsx` och ändras inte av detta beslut; ändras h1 eller ingress måste `<noscript>` och `description` uppdateras (testet ovan fångar h1).
- Bilder och skärmdumpar i sektionerna läggs som Vite-importer (hashade, `immutable`) eller i `public/` (`no-cache`), laddas med `loading="lazy"` under första skärmen och får bredd/höjd för att inte flytta layouten.

### Antaganden (flaggade)
- Det primära målet är korrekta delningsförhandsvisningar och grundläggande Google-närvaro för en nischad app; landningens innehåll är i huvudsak rubrik, ingress och en förklaring i fyra steg, och förhandsvisningens flock är påhittad exempeldata. Är organisk söktrafik ett uttalat tillväxtmål är det en ägarpreferens som kan flytta beslutet mot (b).
- Googles andra vågs rendering räcker för landningens indexering. Det följs upp i Search Console efter lansering.

### Revisit
Ta upp (b) (prerender via separat `landing.html` och Caddy-regel för `/` och `/login`, med egen följdstory som hanterar hydrering mot RUN-219, uppräkningens startvärde och hur de sanna siffrorna visas) om något av detta inträffar:
- Search Console visar att `/` inte indexeras eller inte renderas korrekt inom några veckor efter lansering.
- Lighthouse mobil på `/` ger dålig LCP/FCP och vattenfallet inte går att åtgärda billigare.
- Landningen får fler publika, indexerbara sidor (FAQ, blogg, publika packs).
- Ägaren sätter organisk sök eller betald trafik som mål.
