# 006. Navigering och skärmstruktur: riktiga routes, ett app-skal, responsiv variant

## Status
Godkänd av ägaren 2026-10-04 (redesign-beslut 1–5)
Addendum 2026-10-13 (RUN-200): renderingsstrategi för den publika `/`. Metadata-delen gäller; renderingsbeslutet (a) är delvis ersatt av addendum 2026-10-19 (RUN-260), se längst ner.
Addendum 2026-10-19 (RUN-260): förrenderad landning. Godkänd av ägaren 2026-10-19, se längst ner.

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
     (App Prototype är facit; surfplatta i stående läge får mobilskalet
     med centrerad maxbredd ~640 px); ≥ 1024 = desktopvarianten (Web Prototype är
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
     brytpunktshooken i skalet. [Undantag 2026-10-19 (RUN-260): landningen
     renderar båda varianterna och väljer med CSS, se addendum 2026-10-19
     punkt 5. Skalet är oförändrat.]
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
   duell ur `/challenges/my`, Strava ur `/strava/last-sync` (borttagen i v0.7.1, RUN-319; `last_import_at` i `/strava/status` ersätter den); streak-deadline
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
  rendering av `/` omprövas. [Besvarad 2026-10-13 (RUN-200: statisk metadata);
  omprövad och utlöst 2026-10-19 (RUN-260: `/` förrenderas), se addendum
  2026-10-19.]

## Addendum 2026-10-11 (RUN-145, ägarbeslut): login som popup, utloggning till Landing
Ändrar beslut 1 (utloggat träd) och avatarmenyns "Log out" (beslut 4). Resten av ADR:n gäller oförändrad.

1. **Login är en dialog över Landing, inte en egen sida.** `LoginPage` är borta. `/login` renderar samma `Index`-element som `/` (Landing) med `LoginDialog` (`features/auth`, Radix Dialog + skalets `.rq-modal`/`.rq-scrim`) monterad ovanpå. Båda routerna renderar samma komponent på samma plats i trädet, så Landing ommonteras inte när dialogen öppnas eller stängs.
2. **Adressen speglar läget: `/login` (inte `?login=1`).** Skälen: (a) `/login?next=<path>` finns redan som kontrakt (RequireAuth, befintliga länkar, rök-testet i Konsekvenser) och behöver inte byta form; (b) ett sökparameter-läge hade krävt att `next` och flaggan samexisterar i samma query på `/`, där gamla `?tab=`-adresser redan tolkas; (c) en egen path gör Back-semantiken entydig. Sign in-knappen är en vanlig `<Link>` med router-state (`FROM_LANDING_STATE`): knappen pushar `/login`, så Back stänger dialogen; ✕/Esc/scrim gör samma sak (ett steg bakåt när dialogen öppnades från Landing, annars `replace` till `/`, och `next` släpps).
3. **Djuplänkar och skyddade sidor.** `/login` och `/login?next=/titles` ger Landing med dialogen öppen; efter inloggning går man till `next` (`resolveNextPath`, bara interna adresser, aldrig en öppen redirect — oförändrat). `RequireAuth` skickar fortfarande utloggade på en skyddad route till `/login?next=<path>`, som nu alltså betyder Landing + dialog + bevarad `next`. [Tillägg 2026-10-19 (RUN-260): när inloggningen sker från den förrenderade `/` (lean ingång) blir övergången till `next`/`/board` en full sidladdning som visar appens laddningsvy tills appen ritat, se addendum 2026-10-19 punkt 8 och 11. Inloggning från `/login?next=…` (fullappen, 401-flödet) är oförändrad.]
4. **"Log out" → `/`, utan dialog och utan `next`.** AvatarMenu navigerar (`replace`) till `/` i samma händelse som `logout()`; de batchas till en rendering, så `RequireAuth` hinner aldrig skicka till `/login?next=`. Ordningen mellan de två anropen spelar ingen roll; kravet är att `logout()` nollställer användaren synkront i samma händelse (inget `setTimeout`, ingen `await` före `setUser`). Annars hinner en rendering emellan med användaren kvar på `/` (Index → `/board`) eller adressen kvar på den skyddade sidan (RequireAuth → `/login?next=`). `App.logout.test.tsx` faller om `logout()` skjuts upp eller görs asynkront före `setUser` (verifierat med mutationer).
5. **401 mitt i sessionen → `/login?next=<sidan>` (Landing med dialogen öppen).** Valt framför "Landing utan dialog": användaren fick sin session avbruten mot sin vilja och ska komma tillbaka dit hen var. Det är samma väg som RequireAuth redan tog (`onUnauthorized` nollställer användaren; RUN-143:s `queryClient.clear()` är oförändrad). Ingen loop: `clear()` startar ingen omhämtning, och den utloggade vyn gör inga anrop.
6. **Gränsen mot "Landing gör inga anrop" (ägarbeslut 4).** Landing-FEATUREN (`features/landing`) är oförändrat publik: inga anrop, ingen `useAuth`, ingen import ur `features/auth` (vaktat i `guards.test.ts`). Den enda kopplingen är att Sign in-länken navigerar. Dialogen, som anropar `AuthProvider.login`, monteras av sidan (`pages/Index`), inte av featuren. Utloggad gör `/` och `/login` därmed fortfarande inga backend-anrop förrän man skickar in formuläret.
8. **`next` mot kontrolltecken.** `resolveNextPath` avvisar alla kontrolltecken (U+0000–U+001F, U+007F) och kräver att adressen tolkas till samma origin som sidan (`new URL(next, origin).origin`); fallback `/board`. Webbläsarens URL-tolkning tar bort tab/LF/CR, så `/<tab>/evil.com` blev `//evil.com` och gav SecurityError i `replaceState` (vit skärm). Testat i `legacyRedirects.test.ts` och genom riktig `<App/>` (`App.login.test.tsx`).
9. **Dialogen går alltid att lämna.** ✕, Esc, scrim och Back fungerar även under pågående inloggning (`backendApi.login` har ingen timeout, så en spärr hade gett en död ✕ utan signal). Försöket avbryts då (`AbortSignal` från `useLoginForm` till `AuthProvider.login`): ett svar som kommer efter att dialogen lämnats kastas — token rensas, ingen användare sätts, ingen cache rensas, inget fel visas — så Landing står kvar och ingen navigering till `/board` sker mot användarens vilja.
10. **Designspråk.** EN guldknapp per vy: i dialogen är "Sign In" den enda aktiva (Landings knapp ligger bakom scrimmen, mörkad och dold för hjälpmedel). Måttet `--rq-login-w` återanvänds; `--rq-login-logo-w` och `--rq-login-glow-*` är borttagna ur temafilen (logotypen och gloden finns på Landing bakom dialogen).

## Addendum 2026-10-13 (RUN-200): renderingsstrategi för den publika landningen `/`
Besvarar revisit-triggern "Landing-inkrementet blir publik/SEO-relevant → server-/statisk rendering av `/` omprövas". Beslut 1–12 och addendum 2026-10-11 gäller oförändrade: `/` och `/login` förblir en klientrenderad SPA-route. Status: metadata-delen (RUN-205) gäller oförändrad; renderingsbeslutet (a) nedan är ersatt i de delar som anges i addendum 2026-10-19 (RUN-260), där `/` förrenderas. Ingen ADR ersätts. Arkitekturdiagrammet ändras inte (inga nya runtime-komponenter eller kopplingar).

### Beslut
**Alternativ (a): statisk metadata i `apps/frontend/index.html`.** Titel, description, Open Graph, Twitter-kort, canonical, ikoner/manifest-länkar och en kort `<noscript>`-text. Ingen prerender, ingen SSR, ingen ändring i `Caddyfile`, Vite-konfigen, `main.tsx` eller routern. RUN-205 räcker; ingen följdstory föreslås (se "Revisit" för när (b) tas upp igen). [Ersatt 2026-10-19 (RUN-260), i de delar "ingen prerender, ingen SSR, ingen ändring i `Caddyfile`, Vite-konfigen, `main.tsx` eller routern": revisit-triggern utlöstes och `/` förrenderas nu via en egen lean ingång, se addendum 2026-10-19. Metadatadelen gäller kvar.]

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

Varför (b) inte är värt det nu, konkret: [Historiskt resonemang 2026-10-13. Alla sex skälen besvaras punkt för punkt i tabellen "Hur skälen i addendum 2026-10-13 mot prerender besvaras" i addendum 2026-10-19.]
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
- **Hydrering:** ingen. `main.tsx` behåller `createRoot` och `App.tsx` sin laddare; inget byte av renderingsläge. [Ersatt 2026-10-19 (RUN-260): `/` hydreras av en separat lean ingång (`hydrateRoot`); `main.tsx` och `App.tsx` är fortsatt `createRoot` för fullappen, men laddningsvyn delas, se addendum 2026-10-19 punkt 11.]
- **Animationer, ArenaTrack, uppräkning:** orörda; de startar när landningen monteras, som idag. [Uppräkningen (`useCountUp`) är borttagen sedan RUN-208; CSS-animationerna startar ur förrenderad HTML, se addendum 2026-10-19 punkt 7.]
- **Lazy-laddning (RUN-219):** orörd. Inloggade betalar inte för landningskoden. Kostnaden är att en besökare får en vattenfall (`index.html` → entry-chunkar → `Index`-chunken + `landing.css`/`board.css` + typsnitt från Google). Mät först (Lighthouse mobil på `/`) innan något görs; det är en revisit-trigger, inte ett skäl för (b) nu.
- **Caddys cachepolicy:** ingen ändring. `index.html` är `no-cache`, så metaändringar når användarna vid nästa omladdning; `/assets/*` är `immutable` och berörs inte. Filer i `public/` (ikoner, OG-bild, manifest, sitemap) går via catch-all-blocket och blir `no-cache` (revalidering med ETag), vilket är rätt eftersom de inte har hashade namn. Plattformarna cachar länkförhandsvisningar per URL: byt filnamn på OG-bilden vid ändring (eller använd plattformarnas debugger) i stället för att skriva över. [Ersatt 2026-10-19 (RUN-260) för `/`: en ny Caddy-regel serverar `landing.html` med `no-cache` för exakt `/`, se addendum 2026-10-19 punkt 3. Övriga delar gäller.]
- **Avvikelse (Lead godkände 2026-10-13, RUN-257/RUN-205):** `Caddyfile` ändras ändå, av filmen: blocket `handle /media/*` (immutable, 404 för saknad fil) och ett explicit `Content-Type: application/manifest+json` för `.webmanifest` (Go/Caddy saknar typen i sin inbyggda tabell). Beslutet "ingen ändring i `Caddyfile`" gäller alltså inte längre; `verify-static-serving.sh` prövar båda.
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

**RUN-207–210 (landningens sektioner).** Eftersom kroppen inte prerenderas: [Ersatt 2026-10-19 (RUN-260): `/` förrenderas nu, så sökbart innehåll finns i rå-HTML; kravet att sektionerna inte får kräva byggtidsdata och att hämtad data har laddnings-/felläge gäller kvar, se addendum 2026-10-19 punkt 6.]
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
- Lighthouse mobil på `/` ger dålig LCP/FCP och vattenfallet inte går att åtgärda billigare. **[UTLÖST 2026-10-19 (RUN-260): RUN-259 mätte LCP ca 4,2–4,4 s lokalt mot målet 2,5 s. Prerender är nu valt och godkänt av ägaren 2026-10-19; se addendum 2026-10-19. Valet blev en egen lean ingång för exakt `/` (inte `/login`), alltså en snävare variant än "Caddy-regel för `/` och `/login`".]**
- Landningen får fler publika, indexerbara sidor (FAQ, blogg, publika packs).
- Ägaren sätter organisk sök eller betald trafik som mål.

## Addendum 2026-10-19 (RUN-260): förrendera landningen `/` och skicka mindre kod vid första besöket
Utlöser revisit-triggern i addendum 2026-10-13: "Lighthouse mobil på `/` ger dålig LCP/FCP och vattenfallet inte går att åtgärda billigare". Mätt i RUN-259: LCP på `/` ca 4,2–4,4 s lokalt (mål < 2,5 s; budgettaket är 5 000 ms), prestandapoäng 0,80–0,82 mot taket 0,75, JS 237 kB av 275 kB. CHANGELOG (RUN-257) noterar att resten av LCP hänger på JS-kedjan: filmens poster laddas först efter JS.

**Status: Godkänd av ägaren 2026-10-19.** Ägarbesluten A och B är JA, C är villkorat och avgörs efter mätningen i S1 (se "Ägarbeslut"). Ägaren har lagt ett uttryckligt krav på övergången efter inloggning (beslut A, punkt 8 och 11): **inloggning från landningen ger en full sidladdning till appen, och den som loggar in ska se appens befintliga, redan designade laddningsvy (stadion-ovalen) i stället för en blank sida.**

**Ersätter (dubbelriktat):** addendum 2026-10-13, beslutet "(a) statisk metadata, ingen prerender, ingen SSR, ingen ändring i `Caddyfile`, Vite-konfigen, `main.tsx` eller routern" och dess rader "Hydrering: ingen" och "Caddys cachepolicy: ingen ändring" (markerade som ersatta i det addendumet). Metadatadelen (RUN-205: title, OG, canonical, ikoner, manifest, `<noscript>` i `index.html`) gäller oförändrad. Beslut 1–12 och addendum 2026-10-11 gäller; särskilt beslut 11 (skalet och huvudsidorna eager) rörs inte, se alternativ X nedan. Beslut 5 (exakt EN variant i DOM) får ett avgränsat undantag för landningen, punkt 5, och är markerat där. Addendum 2026-10-11 punkt 3 får ett tillägg om inloggning från `/`, markerat där.

### Beslut
**Alternativ (c), båda, genom en egen lean ingång för landningen: `/` förrenderas vid bygget och hydreras av en separat, liten ingång; hela appen (`index.html`, `main.tsx`, `routes.tsx`) lämnas orörd i sin struktur.** Två smala tillägg rör fullappens ingång och beskrivs i punkt 11: laddningsvyn delas av en komponent, och `index.html` får laddningsvyn förrenderad i `#root` så att en sidladdning aldrig visar en blank sida.

1. **Två HTML-filer, två ingångar.**
   - `index.html` + `main.tsx` + `App.tsx` (hela appen): oförändrad struktur. Serveras för alla adresser utom exakt `/`, alltså även `/login`, `/legal`, `/board` och 401-flödets `/login?next=…`. Inloggade användare berörs inte av prerendern. Enda tillägget är laddningsvyn i `#root` (punkt 11).
   - `landing.html` + `landing-main.tsx` (ny, lean): serveras bara för exakt `/`. Innehåller den förrenderade landningen i `#root`. Ingången bär bara det en utloggad besökare på `/` behöver: `AppProviders`, `BrowserRouter`, landningen (eager, inte via `React.lazy`), `LegalPage` (lazy) och inloggningsdialogen (lazy, se punkt 8). Den importerar inte `routes.tsx`, `AppShell`, `RequireAuth`, huvudsidorna eller touren (`driver.js`). Den importerar `RoutePending` (laddningsvyn, punkt 11), som är liten.
   - Den lean routern har fem routes: `/` och `/login` (samma element på samma plats, addendum 2026-10-11 punkt 1 består), `/landing` och `/landing.html` (filadresserna som Caddys `try_files` löser till `landing.html`, se rättelsen i punkt 3: landningen, med adressen omskriven till `/`), `/legal` (lazy) och `*` = **överlämning till fullappen**: en komponent som **renderar `RoutePending` (appens laddningsvy) och i en effekt gör `window.location.replace(<aktuell adress>)`** (full sidladdning, Caddy ger då `index.html`). Laddningsvyn ersätter landningen i samma rendering som routern byter till `*`, så det finns aldrig en blank ram i det gamla dokumentet. Överlämningen kör aldrig för `/` (ingen loop). Så sker också efter lyckad inloggning från landningen: `Index` navigerar (som i dag) till `next`/`/board`, lean routern lämnar över, och fullappen startar med token redan sparad.
2. **Prerendern är ett eget byggsteg utan nytt beroende och utan webbläsare.** `npm run build` i `apps/frontend` blir `vite build` följt av ett skript (`scripts/prerender-landing`) som (i) bygger en SSR-bunt av `landing-ssr.tsx` med `vite build --ssr` till en tillfällig katalog utanför `dist/`, (ii) renderar trädet med `renderToString` (`react-dom/server`) inuti `StaticRouter` (`react-router-dom/server`), båda redan installerade, (iii) skriver resultatet i `dist/landing.html` genom att byta en markör i `#root`, (iv) **renderar `RoutePending` med `renderToStaticMarkup` och byter markören i `#root` i `dist/index.html` (punkt 11)** och (v) raderar SSR-bunten. Inget server-JS deployas. Ingen Chromium i Railpack-bygget, ingen ny dev-dependency. Faller SSR-steget (en modul rör `window` på modulnivå, ett kastat fel) eller saknas markören i någon av filerna fäller det bygget, så ett trasigt prerender når aldrig prod. `isSsrBuild` slår av Sentry-uppladdningen och `stripSourceMaps` i SSR-bygget (annars laddas kartor upp två gånger). `VITE_APP_ENV` och `define` gäller båda byggena; `stagingGuard` (noindex) gäller båda HTML-filerna.
3. **Caddy serverar prerendern bara för exakt `/`.** Ett nytt block först i `route` (efter `.map`-regeln, före SPA-fallbacken):
   ```
   @landing {
       expression `{http.request.uri.path} == "/"`
       file /landing.html
   }
   handle @landing {
       header Cache-Control "no-cache"
       rewrite * /landing.html
       file_server
   }
   ```
   [Kodblocket rättat 2026-10-19: `path /` som stod här är fel, se rättelsen i slutet av punkten.] Uttrycket jämför den råa sökvägen med `/` (frågesträngen ignoreras: `/?utm_source=…` och gamla `/?tab=…` får också prerendern). `file /landing.html` gör att ett bygge utan filen faller tillbaka på `index.html` i stället för att ge 404. `no-cache` som för `index.html`, så en deploy aldrig fastnar bakom en gammal fil som pekar på borttagna kodfiler. `encode` (gzip/zstd) gäller som för övriga svar. `/landing.html` direkt serveras som fil av SPA-blocket. [Rättat 2026-10-19 (RUN-331, kritiken): det är inte ofarligt. `try_files {path} {path}.html …` löser både `/landing.html` och `/landing` till filen redan från den dag S4 deployas, och en lean router som lämnar över okända adresser laddade då om samma adress i en evig loop. Lean routern behandlar därför `/landing` och `/landing.html` som landningsadresser (renderar landningen, skriver om adressen till `/` med `replace`, ingen omladdning), och loopvakten för inloggning räknar dem som `/`. S6 bör överväga att inte servera filen direkt (404 eller omdirigering till `/`).] [Genomfört 2026-10-19 (RUN-333, S6): regeln står i `Caddyfile` som ovan, med `file_server` för att behålla `hide`-raderna. `/landing.html` och `/landing` omdirigeras med 307 till `/` (frågan följer med; en matchare per fall eftersom Caddy saknar en placeholder för frågan med sitt `?`). 307 och inte 308 så att ingen webbläsare cachar omdirigeringen för alltid; 404 valdes bort eftersom en gammal länk då dör. Lean routerns hantering av filadresserna ligger kvar som försvar. [Rättat 2026-10-19 (RUN-333, kritiken): `path /` (som kodblocket ovan först visade) matchar också `//`, `///`, `/./` och `/%2f`, eftersom Caddys path-matchare slår ihop snedstreck och rensar punktsegment. De fick landing.html, `new URL('//', base)` i `isLandingAddress` kastade och sidan blev vit (`/%2f` laddade dessutom om sig själv i en loop). Regeln jämför i stället den råa sökvägen: `expression \`{http.request.uri.path} == "/"\`` tillsammans med `file /landing.html`; de adresserna får index.html som före S6. `isLandingAddress` kastar dessutom aldrig.] `verify-static-serving.sh` prövar `/`, `/?tab=titles`, `/?utm_source=x`, de fem SPA-adresserna, båda omdirigeringarna och ett bygge utan `landing.html`.] Alla andra adresser, inklusive `/login`, är oförändrade (den gamla `try_files … /index.html`).
4. **Sessionstips i `<head>` (inloggade ser aldrig landningen).** Ett litet inline-skript i `landing.html` före stilarna, byggt av en funktion i koden (inte handskrivet i HTML):
   - Läser `runquest_token` och `runquest_user` ur `localStorage` (samma villkor som `backendApi.isAuthenticated()`); nycklarna flyttas till en delad konstant som både `backendApi` och skriptgeneratorn importerar, så de inte driver isär. Allt i `try/catch` (lagring kan vara avstängd).
   - Finns båda: `location.replace(<mål>)` där målet är exakt det `resolveLegacyRedirect` ger (`?tab=` → ny route, övriga parametrar bevaras, hash tappas som i `Index`, annars `/board`). Tabellen genereras ur `TAB_TARGETS`/`paths`, inte kopieras. Skriptet körs före första ritning, så den prerenderade markupen hinner aldrig målas för en inloggad. **Den inloggade som skickas från `/` till appen på det här sättet möter appens laddningsvy i det nya dokumentet (punkt 11), inte en blank sida.**
   - Ett test kör skriptet mot en låtsas-`window` och jämför målet med `resolveLegacyRedirect` för en tabell av adresser.
   - **Varför omdirigering och inte "dölj och låt appen ta över":** lean ingången kan inte rendera `/board`. Kostnaden för den dagliga vägen in är oförändrad i antal sekventiella nivåer: i dag `index.html` → ingångs-JS → lazy `Index`-chunk + landnings-CSS → `Navigate` → `/board`; efter `landing.html` (liten) → `index.html` → ingångs-JS → `/board` (ingen `Index`-chunk, ingen landnings-CSS). Verifieras i staging (risk 6).
   - **CSP:** ingen CSP finns i dag (ingen `Content-Security-Policy` i `Caddyfile`, `index.html` eller `landing.html`; kommentaren i `Caddyfile` säger det uttryckligen för `font-src`). Inline-skript är därför tillåtna nu. `landing.html` får två inline-skript: sessionstipset och `next-themes`-skriptet som `ThemeProvider` renderar (det sätter `data-theme` före första ritning). Införs en CSP senare gäller `script-src 'self' 'sha256-…'` med hashar som bygget räknar ur den färdiga filen (sessionstipset är en konstant, `next-themes`-skriptet är deterministiskt); `nonce` går inte på statisk hosting och `'unsafe-inline'` ska inte användas. Ett test låser antalet inline-skript i `landing.html` till två, så ett tredje inte tillkommer obemärkt. Revisit-trigger nedan.
5. **Landningen gör inga val på bredd i JS (hydreringsparitet).** Prerendern kan inte veta bredden, och ett val som ändrar markupen efter hydrering ger både varning och omstartade animationer. Alla `useIsDesktop()`-grenar i `features/landing` tas bort:
   - `LandingHeader` (nav), ingressen (`LEAD_DESKTOP`/`LEAD_MOBILE`), `PackPreview` (ögonbryn + tre förklaringar) och rubrikklassen i `PackPreview`/`HowItWorks` (synlig h2 på desktop, `sr-only` på mobil): båda varianterna ligger i HTML, CSS väljer med `@media (min-width: 1024px)` (samma brytpunkt som skalet). Dold variant är `display: none`, alltså utanför tillgänglighetsträdet.
   - `ArenaTrack`: båda geometrierna renderas (mobil och desktop, två SVG), CSS visar en. Den dolda SVG:n kör inga animationer (`display: none` startar inga CSS-animationer).
   - `LandingFilm`: båda varianterna mountas; ankar-id:t blir `film` (desktop) och `film-mobile` (mobil), och `WatchFilmButton` väljer mål med `matchMedia` vid klick. `<picture>` i båda väljer redan 720-postern från 1024 px, så en dold, ivrig mobilposter på desktop hämtar samma fil som desktopvarianten (en förfrågan, inget spill).
   - `.rq-landing-hero__film:empty { display: none }` ersätts av en mediaregel (mobilfilmen dold från 1024 px, desktopfilmen dold under).
   - Undantaget från beslut 5 ("exakt EN variant i DOM") gäller bara landningen och bara som `display: none`; skalet (beslut 5) är oförändrat. Beslut 5 avvisade "rendera båda och dölj med CSS" av skäl som inte finns här: skalet har `data-tour`-ankare och hooks som körs dubbelt; landningen har inga tour-ankare, och dolda varianter gör inga anrop (filmen har `preload="none"`).
   - En ESLint-regel (utökar `LANDING_SYNTAX`/`LANDING_IMPORTS`) förbjuder `useIsDesktop`, `matchMedia` i renderingen och `Intl`/`toLocaleString` i `features/landing` (`formatInt` är redan språkoberoende: regex med NBSP, så byggdatorns locale påverkar inte texten).
6. **Sifferraden `—` utan layoutskift.** HTML:en innehåller `—` på tre platser (servern har inget svar, `useQuery` ger `pending`); klienten hämtar efter hydrering som i dag (ett anrop, ingen byggtidsdata, `description`/OG fortsatt utan siffror).
   - Varje stat reserverar sin bredd (`min-width` i `ch` för det bredaste rimliga värdet, t.ex. `99 999`) och raden behåller sin höjd, så talen som anländer inte flyttar grannarna. Om reservationen ändrar hur raden fördelas visuellt (i dag `space-between`) godkänner Designern fördelningen.
   - **Felläget ändras (ägarbeslut B, JA):** i dag `return null` (raden försvinner). Med prerender är raden redan målad, så borttagning skulle skjuta allt under den. Vid fel behåller sifferraden sin höjd: raden blir `visibility: hidden` + `aria-hidden` och står kvar som en tom, reserverad remsa. Det ändrar RUN-208:s "döljs hela raden" (en tom remsa i stället för ingen) och är nu ett godkänt ägarbeslut.
7. **Animationer och film startar inte om vid hydrering.** Rutnät, löpare, XP-pop, ring, sweep och staplar är rena CSS-animationer som startar när HTML + CSS målas, före JS. `hydrateRoot` adopterar befintliga noder och rör inte deras `style`/klasser, så en animation tar inte om sin tidslinje, under förutsättning att klientens första rendering är identisk med serverns (punkt 5 gör det). Det finns ingen JS-driven uppräkning kvar (RUN-208 ersatte den med `—`; texten om `useCountUp` i addendum 2026-10-13 är föråldrad). Filmen är `preload="none"`, har ingen autoplay och startar bara på tryck, så det finns inget uppspelningstillstånd att tappa. Spelartillståndet (`useFilmPlayer`) börjar `idle` på båda sidor.
8. **Inloggningsdialogen över landningen (`/login`) och övergången efter inloggning.**
   - `/` prerenderas, `/login` gör det inte (Caddy skickar `index.html`). Den som klickar Sign in på `/` stannar i lean routern: länken pushar `/login` (oförändrat, `FROM_LANDING_STATE`), samma element ligger kvar och dialogen monteras ovanpå, så landningen ommonteras inte (addendum 2026-10-11 punkt 1).
   - **Dialogen laddas lazy i lean ingången** (Radix Dialog + formulär + `login.css` ska inte ligga i första besökets JS) och förhämtas på första tecken på avsikt: `pointerover`/`focusin`/`touchstart` mot Sign in-länken, fångat på sidnivån (landningsfeaturen får fortfarande inte importera `features/auth`, vaktat i `guards.test.ts`). Fullappens `Index` (för `/login` och 401-flödet) behåller den eager importen: där behövs dialogen direkt. Hur `Index` delas mellan de två ingångarna är ett genomförandeval; beteendet i addendum 2026-10-11 får inte ändras.
   - **Ägarbeslut A (JA): inloggning från landningen ger en full sidladdning till appen** (överlämningen i punkt 1) i stället för dagens övergång i appen. Det är den enda synliga beteendeförändringen för användare och sker bara när man loggar in från prerendern; 401-flödet (`/login?next=…`) körs i fullappen och är oförändrat.
   - **Ägarens krav på övergången (uttryckligt):** "när man loggar in så får man en snygg loader som vi ändå redan designat". Övergången efter inloggning visar appens befintliga laddningsvy (`RoutePending`, som renderar `TrackLoader`; se punkt 11) i stället för en blank sida. Samma krav gäller inloggade som skickas från `/` till appen av sessionstipset (punkt 4). Ingen ny design; Designern behöver inte ta fram något.
9. **Hydreringsvarningar: källor och vakter.** Mismatch ger en `console.error` i dev och ett återställbart fel i prod (React kastar bort och klientrenderar delträdet: synligt byte och omstartade animationer).

   | Källa | Läge |
   |---|---|
   | Viewport-grenar (`useIsDesktop`, `matchMedia`) | borttagna ur landningen (punkt 5), ESLint-vakt |
   | `Date`/`Math.random` i render | finns inte i landningens renderväg (`useJoinWaitlist` använder `Date.now` bara i effekt/submit); ESLint-vakt utökas |
   | Locale (`toLocaleString`, `Intl`) | används inte; `formatInt` är regex; vakt som ovan |
   | `useId` | kräver samma komponentträd på server och klient: SSR-ingången delar `AppProviders` och landningsträdet med klientingången via en gemensam komponent, bara routern byts (`StaticRouter`/`BrowserRouter`) |
   | `next-themes` (inline-skript, `data-theme`), `Sonner` (`<section>`), Radix | renderas av samma providers på båda sidor; verifieras av hydreringstestet |
   | Stagingbannern (lazy, bara `VITE_APP_ENV=staging`) | SSR importerar den statiskt, klienten lazy bakom `Suspense` med serverns `<!--$-->`-markörer, så React behåller serverns HTML tills chunken är laddad |
   | `window`/`localStorage` på modulnivå | `backendApi`-konstruktorn rör inget; SSR-bygget fäller bygget om en modul gör det |
   | Webbläsartillägg som ändrar DOM | återställbara fel går till `onRecoverableError` som loggar, rapporterar inte |

   **Hydreringstest (Vitest):** renderar SSR-strängen, sätter den i jsdom, kör `hydrateRoot` med spion på `console.error` och `onRecoverableError`, kräver noll anrop, och att DOM-noderna före och efter är identiska objekt (inget byte).

   **Inmatning före hydrering (RUN-336).** Ett formulär i den förrenderade landningen är `inert` tills det hydrerats (`useHydrated`, `useSyncExternalStore` med serverns ögonblicksbild falsk): före hydreringen skrivs inget ifyllt över av tomt state och Enter ger ingen nativ GET-submit som laddar om sidan. Serverns och klientens första rendering är lika, och inerten släpps i omrenderingen direkt efter hydreringen. Se `apps/frontend/src/landing-entry/README.md`.
10. **Lighthouse CI efter resultatet (S7).** `lighthouserc.json` får per-URL-regler (`assertMatrix`): `/` skärps, `/legal` behåller dagens rader (den serveras fortfarande av hela appen och delar inte landningens vikt). Sättning av taken, i ordning:
    1. Mät `/` på CI-runnern (Linux/Chrome), minst fem gröna körningar av `main` med prerendern på, i båda lägena (API ger fel / falskt API).
    2. LCP-taket = målet 2 500 ms om medianen ligger under 2 250 ms (10 % marginal). Annars: tak = högsta mediansiffran × 1,1 avrundat uppåt till närmaste 100 ms, aldrig över dagens 5 000, och målet 2 500 ms står kvar som öppen rad i `docs/performance.md` tills det nås (RUN-260 är då inte klar mot sitt mål, och det sägs).
    3. Övriga rader: prestanda minst `min(0,90, uppmätt median − 0,03)`; JS-vikt = uppmätt × 1,15 avrundat uppåt till 5 kB; TBT-tak 150 ms om medianen är under 100 ms (hydrering på 4× CPU-bromsning är det som kan höja den, se risk 2), annars oförändrat 200; CLS-tak sänks från 0,05 till 0,02 om medianen är under 0,01; en ny rad för `first-contentful-paint` (uppmätt × 1,15). Tillgänglighet, SEO, best practices oförändrade.
    4. Att skärpa kräver inget ägarok (`docs/release.md`); `scripts/lighthouse-ci.test.mjs` (golv/tak) uppdateras i samma PR som skärper, aldrig tvärtom. Att dela raderna per URL lättar inget för `/legal` och är därför inte en sänkning, men PR-beskrivningen ska säga det uttryckligen. `/legal` serveras av `index.html` som nu bär laddningsvyn i `#root` (punkt 11); `/legal`-raderna lämnas oförändrade och S7 anger uppmätt median för dem före och efter, så en regress syns.
    5. `STATS_MODE=error|mock` och `run.sh` behöver ingen ändring: Caddy med repo-rotens `Caddyfile` serverar `landing.html` för `/` automatiskt.
11. **Övergången till appen visar appens befintliga laddningsvy, aldrig en blank sida (ägarkrav, beslut A).**
    - **Vald laddningsvy: `RoutePending`** (`apps/frontend/src/app-shell/RoutePending.tsx`), som renderar `TrackLoader` (`apps/frontend/src/shared/components/loaders/TrackLoader.tsx`, stadion-ovalen, designspråk regel 9, `size={192}`, `label="Loading"`, `role="status"`) i `.rq-shell__pending` (`apps/frontend/src/app-shell/app-shell.css`: centrerad, `min-height: calc(100dvh - var(--rq-staging-banner-h))`, `background: var(--rq-bg-shell)`). Det är exakt den bild `App.tsx` redan visar medan sessionen läses (`loading`) och som `AppShell` visar tills `useIsDesktop` läst bredden. Den redan designade stadion-ovalen med korten (Loaders-designen, `docs/design/claude-design/`) används; `SkeletonRows` (sidfallbacken i `ShellOutlet`) är en annan sak, innehållsplatshållare inne i skalet, och används inte här. Ingen ny design, ingen ny komponent. [Tillägg 2026-10-19 (RUN-338, ägarbeslut "förstora loadern x3 så att den syns tydligare"): vyn är tre gånger så stor, `size={192}` i stället för 64, alltså en omslutande rektangel på ca 217 x 167 px (var ca 72,5 x 55,8 px). Storleken sätts bara i `RoutePending`; övriga `TrackLoader`-platser behåller sina storlekar. Banlinjen följer storleken över förlagans spann (`laneStrokeWidth`: 2 px upp till 100 px, därefter jämn ökning till 6 px vid 192 px), prickarna följer redan storleken (`runnerRadius`), så ovalen ser likadan ut, bara större. Rektangeln är identisk i `index.html` före JS och i gaten efter React (prövas i `landing.spec.ts` på 320, 390 och 1440 px).]
    - **EN laddningsvy.** `App.tsx`:s `loading`-gren och `AppShell`:s `isDesktop === undefined`-gren duplicerar i dag `RoutePending`:s markup. De byter till `RoutePending`, så att det finns en enda definition av laddningsvyn som lean ingången, fullappen och den förrenderade `index.html` delar. Markupen får inte ändras av detta (befintliga tester ska passera oförändrade).
    - **Tre ställen där vyn måste synas, så att ingen ram är blank** (ett fjärde tillkom 2026-10-20, se 4):
      1. **I det gamla dokumentet:** lean routerns `*`-överlämning (punkt 1) renderar `RoutePending` i samma rendering som landningen försvinner, innan `window.location.replace` körs. Kräver att `.rq-shell__pending` (och `rqOrbit` ur `index.css`, redan global) finns i lean ingångens CSS utan att hela skalets CSS (`app-shell.css`) dras in i första besökets CSS; regeln flyttas i så fall till ett litet delat lager (genomförandeval, men kravet på CSS-innehåll prövas i S4).
      2. **I det nya dokumentet innan JS körts:** `dist/index.html` har `RoutePending`:s markup förrenderad i `#root` (prerender-skriptet byter en markör, punkt 2). Webbläsaren målar den så snart CSS är laddad, före ingångs-JS; `createRoot(...).render(<App />)` ersätter den (ingen hydrering; samma plats och storlek som `App.tsx`:s `loading`-gren, så byte syns som att samma bild står kvar). Detta täcker också det inloggade sessionstipset (punkt 4), direktlänkar till `/board` och alla andra SPA-adresser. `<noscript>`-blocket i `index.html` får en `<style>` som döljer `#root` utan JavaScript, så att en snurra inte snurrar för alltid där inget JS finns.
      3. **Kedjan efter första React-renderingen:** `App.tsx` (`loading`) → `RoutePending` (Suspense i `AppRoutes`) → `AppShell` (`isDesktop` odefinierad) → sidans egen fallback i `ShellOutlet`. Alla är samma bild på samma plats utom den sista (sidans skeleton), så vyn står kvar tills appen ritat. [Tillägg 2026-10-19 (RUN-337, ägarbeslut): på den första laddningen av `/board` sitter `FirstBoardGate` (`apps/frontend/src/app-shell`) som layout-route mellan `RequireAuth` och `AppShell` och visar `RoutePending` tills allt som podiekorten ritas ur finns: topplistan (`users-with-runs`) och, i Season-vyn, titlarna (`/titles/user/:id`, efter gruppen, som ger id:na), rank-pilarna och gruppens badges (parallellt med gruppen). Ingen bildruta visar alltså Board med tomt podium eller ett kort med "No titles held yet", en platt pil (—) eller utan badge-mini som fylls på. Week och Streaks ritar inte dekoren och väntar bara på gruppen. Gaten använder Boards egna frågor (`useSeasonBoardData`, delad med `SeasonView`) och cache-nycklar, så ingen fråga går två gånger; `users-with-runs` har `staleTime` 10 s, längre än gatens tak, så att sidan som monteras när gaten släpper inte hämtar om den. Gaten startar själv hämtningen (sidan är inte monterad än), avgörs en gång när den monteras och släpper bara en väg: senare navigering, bakgrundsuppdatering och andra sidor ser den aldrig, och den släpper också om användaren lämnar `/board` medan den håller. Den släpper vid svar från alla delar, vid första misslyckade försöket i någon del (omförsöken fortsätter då under Board, som visar sin laddning och sedan sin felvy; vore gaten kvar till slutgiltigt fel startar Boards nya observatörer om hämtningen och felvyn dröjer dubbelt) och efter taket `FIRST_BOARD_DATA_MAX_WAIT_MS` = 8 s, räknat från monteringen för hela kedjan. Övriga sidor är oförändrade: bara Board har ett podium som annars ritas tomt. Mätt mot stubbat API med 300 ms per svar: Board syns först efter 643 ms i stället för 331 ms, men då helt ifyllt (före: 19 bildrutor med tomlägen, fullt ifyllt efter 650 ms); gruppen hämtas en gång i stället för två.]
      4. **Omdirigeringar inne i appen** [Tillägg 2026-10-20 (RUN-341)]: en `<Navigate>` som ensam är det som renderas (utanför skalet) ritar ingenting, och medan routern laddar målets lata chunk står `#root` då tom. `PendingNavigate` (`apps/frontend/src/app-shell/PendingNavigate.tsx`) ritar `<Navigate replace />` tillsammans med `RoutePending`, och används av `RequireAuth` (utloggad på skyddad adress → `/login?next=`), `pages/Index.tsx` (SPA-inloggning) och `LegacyChallengesRedirect` (`/challenges` → `/duels`). `<Navigate>` inne i skalet (`AdminRoute`, `RunnerPage`) behöver det inte, eftersom skalet redan är ritat. Prövas i `apps/e2e/tests/transitions.spec.ts` (ingen bildruta med tom `#root`, laddarens rektangel står still).
    - **Markören är kommentar:** `index.html` får `<div id="root"><!--app-loader--></div>`. Vite dev-servern rör den inte (blank före JS i dev är accepterat). Skriptet fäller bygget om markören saknas i `dist/index.html`.
    - **Test (S4):** `#root` i `dist/index.html` är byte-för-byte `renderToStaticMarkup(<RoutePending />)`; `App.tsx` i `loading`-läge och `AppShell` i `isDesktop`-odefinierat läge renderar samma markup som `RoutePending`.

### Hur skälen i addendum 2026-10-13 mot prerender besvaras
| Skäl 2026-10-13 | Svar nu |
|---|---|
| 1. `index.html` är gemensam; prerendern blinkar för inloggade | Egen fil `landing.html` och Caddy-regel för exakt `/`; `index.html` får ingen landning (bara laddningsvyn, punkt 11) |
| 2. Inloggade ser landningen före `Navigate` | Head-skriptet omdirigerar före första ritning (punkt 4); fullappens routing ändras inte (bara omdirigeringarna ritar laddningsvyn, punkt 11.4, 2026-10-20). Inloggade möter laddningsvyn, inte landningen och inte en blank sida (punkt 11) |
| 3. Hydrering krockar med RUN-219 (lazy `Index`, `TrackLoader`) | Lean ingången har landningen eager och ingen `loading`-grind; fullappens lazy-gränser (beslut 11) rörs inte |
| 4. Animationer och uppräkning startar om | CSS-animationer startar ur HTML; ingen uppräkning finns; inga JS-val på bredd (punkt 5 och 7) |
| 5. Sanna siffror går inte att prerendera | `—` i HTML, hämtas i klienten efter hydrering; inget byggtidsanrop, inga fasta siffror |
| 6. Verktygen (SSR-entry, Chromium) | `react-dom/server` i Node, ingen Chromium, inga nya paket; landningen är redan fri från `window` på modulnivå, och bredd-hooken (enda läsaren av `matchMedia`) tas bort |

### Alternativ som övervägts
- **(a) Bara prerender, hela appen som ingång.** Bortvalt: HTML syns tidigt men all kod (skal + huvudsidor, i dag eager i ingångs-chunken) laddas och körs före hydrering, så interaktivitet och TBT blir kvar; `AuthProvider.loading` och lazy `Index` måste dessutom ändras för att markupen ska matcha. Ger mindre än hälften av vinsten.
- **(b) Bara koddelning (landningen utan appens skal).** Bortvalt som ensam åtgärd: vattenfallet `index.html → JS → Index-chunk + CSS → poster` finns kvar, och postern (troligen LCP-elementet, se antaganden) kan inte börja hämtas förrän JS har renderat. Kodminskningen behålls ändå, eftersom lean ingången är just (b).
- **X. Dela fullappens `routes.tsx` (lazy `AuthedRoutes`) i en enda ingång.** Bortvalt: ändrar beslut 11 och `routes.guard.test.ts`, lägger ett chunkhopp på den dagliga vägen `/board` och direktlänkar (modulepreload villkorat på session går bara med ett eget Vite-plugin för hashade namn), och ger ett enda träd som måste vara hydreringsidentiskt för både in- och utloggade. Den valda lean ingången låter fullappen vara precis som den är. Ägaren har valt full sidladdning vid inloggning (A) framför X. X omprövas om överlämningen (full sidladdning efter inloggning) visar sig oacceptabel trots laddningsvyn.
- **Ingen laddningsvy vid överlämningen (blank ram tills fullappen ritat).** Bortvalt av ägaren: övergången ska visa den redan designade laddaren.
- **Ny, särskild splash för inloggningen.** Bortvalt: ägaren vill ha den befintliga laddaren; en andra laddningsvy vore en ny design och ett andra underhåll.
- **Förrendera även `/login`.** Bortvalt: uppdraget säger bara exakt `/`; `/login` är en dialog över samma sida och skulle kräva att dialogen förrenderas (Radix Portal) eller ett "öppen"-läge i HTML. Revisit om `/login` visar sig vara en vanlig ingång.
- **Botdetektering i Caddy eller prerender-tjänst (prerender.io, edge-rendering hos annan host).** Bortvalt av skälen i addendum 2026-10-13 (dubbelt innehåll, återkommande kostnad, flytt av hosting); här dessutom onödigt eftersom bygget själv kan skriva filen. Build-vs-buy: att köpa ger inget som ett litet eget byggsteg inte ger, och en tjänst skulle hamna i leveransvägen för en publik sida.
- **Ramverk (Astro, vike, vite-ssg).** Bortvalt: nytt beroende och migrering för en enda sida; bygget behöver ett enda `renderToString`-anrop.
- **Inline kritisk CSS / handplacerade `modulepreload` för landningschunkar.** Skjuts upp: Vite lägger själv CSS-länk och modulepreload i `landing.html` eftersom den är en riktig HTML-ingång; kritisk CSS prövas först om S6-mätningen visar att CSS blockerar LCP. [Uppföljning 2026-10-20 (RUN-343): kritisk CSS prövades och gav ingen LCP-vinst; det som kostade var JS:et före första ritningen. Vites modulskript och `modulepreload` i `landing.html` byts i bygget mot ett externt boot-skript (`assets/landing-boot-<hash>.js`) som laddar ingången efter first-contentful-paint, se `docs/performance.md`, "Landningens LCP mot 2,5 s". `landing.html` har fortfarande exakt två inline-skript (punkt 4).]

### Konsekvenser
- **Kostnad, data, känsligt:** ingen kostnadsdrivande tjänst, ingen databas, ingen extern lagring, inga personuppgifter, inget nytt beroende. Byggtiden ökar med SSR-bygget och två `render*`-anrop (hypotes: en handfull sekunder; mäts i S4). Ingen avvikelse (15c).
- **Positivt:** HTML med h1, ingress, previewkort och steg finns i svaret, så delningsbotar och sökrobotar som inte kör JS ser innehållet (löser även revisit-punkten "kroppen finns inte i rå-HTML" i addendum 2026-10-13); första målningen kommer ur HTML + CSS, inte ur JS-kedjan; landningens JS skär bort appens skal och huvudsidor; `/legal` och inloggade påverkas inte annat än att varje SPA-adress nu målar laddningsvyn före JS i stället för en tom sida (en förbättring även för direktladdning av `/board`).
- **Negativt/risker:**
  1. **Målet 2,5 s är inte garanterat.** Förväntan (hypotes, ej mätt) bygger på att LCP-elementet på mobil är filmens poster (27 kB webp) eller h1. S1 mäter vilket elementet är innan bygget börjar; S6 mäter efteråt. Uteblir målet: mindre poster, ingen poster i första skärmen på mobil (designbeslut), eller kritisk CSS. Se ägarbeslut C.
  2. **Hydrering kan höja TBT** (4× CPU-bromsning): hela landningen hydreras i ett svep. Åtgärd om TBT > 150 ms: `React.lazy` + `Suspense` runt sektioner under första skärmen (selektiv hydrering, serverns HTML behålls) och `startTransition`.
  3. **Teckensnittsbyte kan ge layoutskift.** Alla `@font-face` har `font-display: swap`, bara Bebas Neue är förladdad. Prerendern målar text i reservtypsnitt tills övriga snitt kommit. CLS-taket (0,05, sedan 0,02) fångar det; åtgärd vid behov: `size-adjust` på reservtypsnittet eller förladdning av ytterligare ett snitt.
  4. **Två HTML-huvuden som kan driva isär.** `index.html` och `landing.html` delar metadata. `staticHead.test.ts` utökas att läsa båda filerna och kräva identisk metadata (title, description, OG, Twitter, canonical, ikoner, `theme-color`, manifest); `landing.html` får därutöver sessionstipset och en `<link rel="preload" as="image" … media="(max-width: 1023px)" fetchpriority="high">` för mobilpostern (filnamnet knyts till `LandingFilm`-konstanterna i samma test). `landing.html` behöver ingen `<noscript>` (innehållet står i HTML).
  5. **Överlämningen efter inloggning** är en full sidladdning (ägarbeslut A) som nu bär laddningsvyn hela vägen (punkt 11). Kvarvarande kostnad: tiden från Sign in till Board blir längre än dagens övergång i appen, men inte blank. Mildring: mät `/login` → `/board` på staging; kan förbättras med förhämtning av fullappens ingång vid Sign in-intent (revisit).
  6. **Den dagliga vägen in** ändras från "lazy `Index` → `Navigate`" till "omdirigering före första ritning". Antalet sekventiella nivåer är detsamma (hypotes). Verifieras manuellt på staging av Lead med inloggad användare; Sentrys LCP p75 `/board` (`docs/performance.md`) mäter inte sidladdningar som börjar på `/`, så den fångar bara direktladdning av `/board` och är en kontroll av att fullappen inte regredierat.
  7. **Stale cache.** `landing.html` är `no-cache` och hashade kodfiler är `immutable`; en flik öppen över en deploy får samma `vite:preloadError`-väg som i dag (`staleChunkReload`), och lean ingången installerar den.
  8. **Dubbel kodväg för landningen** (lean ingång + fullappens lazy `Index`). Delade moduler hamnar i gemensamma chunkar (Rollup); `App.login.test.tsx` täcker fullappens variant, ett nytt lean-test täcker överlämningen. Utloggning i fullappen (addendum 2026-10-11 punkt 4) navigerar klientsidigt till `/` och renderar fullappens klientrenderade landning, inte prerendern; prerendern gäller bara en sidladdning av `/`.
  9. **Dold dubbel DOM** i landningen (punkt 5) ökar HTML med de dolda varianterna (hypotes: några kB gzippat). Test som slår på roller (`getByRole`) ser båda varianterna i jsdom (ingen layout) och måste avgränsas per variant.
  10. **Laddningsvyn i `index.html` och vit blixt.** Laddningsvyn målas först när CSS:en har laddats (CSS blockerar ritning), och `html`-bakgrunden (`--rq-bg-page`) och temat (mörkt/ljust via `next-themes`) kommer ur CSS/JS, så ingen fast färg kan skrivas inline utan att bli fel för ljust tema. Chromiums paint holding (samma ursprung) behåller det gamla dokumentet tills det nya kan ritas, så blixten uteblir där; Safari och Firefox kan visa en kort tom ram före CSS. Det prövas manuellt på staging i dem (S6) och är en känd rest, inte ett krav som kan automatiseras i Chromium. Åtgärd om den stör: en liten inline `<style>` med bakgrund per `prefers-color-scheme`, som ett eget beslut.
  11. **Laddningsvyn går i `noscript`.** En snurra som aldrig slutar vore ett fel där JavaScript saknas; därför döljs `#root` av `<noscript><style>` (punkt 11), vilket prövas i S4.
- **Berörda test:** `guards.test.ts` (ny regel: ingen `useIsDesktop` i landningen; `Index`-testet ändras inte), `LandingScreen.test.tsx`, `LandingFilm.test.tsx`, `ArenaTrack.test.tsx`, `LandingStats.test.tsx` (felläget), `staticHead.test.ts`, `scripts/lighthouse-ci.test.mjs`, `scripts/verify-static-serving.sh` (nya kontroller; kontrollen att SPA-adresser ger "tom `#root`" ändras till "`#root` med bara laddningsvyn"), `routes.guard.test.ts` (oförändrad), e2e `login.spec.ts` (ska passera oförändrad), `TrackLoader.test.tsx` och `trackBackdrop.placement.test.tsx` (ska passera oförändrade), nya: prerender, hydrering, sessionstips, överlämning, laddningsvy.
- **Arkitekturdiagram:** inga komponenter eller kopplingar ändras (ingen ny runtime-komponent: prerendern är ett byggsteg, `landing.html` en andra statisk fil på samma host). Sublabeln på `frontend` ("React 18 · Vite 7") bör bli "React 18 · Vite 7 · förrenderad landning" i `docs/architecture/runquest-architecture.json` och kopian i `#spec` i `runquest-architecture.html` (hålls identiska) så att diagrammet inte påstår ren klientrendering. Görs i samma commit som genomförandet av S4/S6 (strikt ingen arkitekturändring, men en tyst motsägelse undviks).

### Ägarbeslut (15b, avgjorda 2026-10-19)
- **A. Inloggning från landningen = full sidladdning till appen: JA.** Ägarens krav: "när man loggar in så får man en snygg loader som vi ändå redan designat". Beslutet inkluderar därför laddningsvyn (`RoutePending`/`TrackLoader`, punkt 8 och 11) och gäller även inloggade som skickas från `/` till appen av sessionstipset. Alternativ X (delad ingång, ingen omladdning) valdes bort.
- **B. Sifferraden behåller höjden vid fel: JA.** Tom, reserverad remsa (`visibility: hidden` + `aria-hidden`) i stället för att raden försvinner (punkt 6).
- **C. Villkorat, öppet: avgörs efter mätningen i S1 av ägaren och Designern** om mobilpostern visar sig vara LCP-flaskhalsen och 2,5 s inte nås. Då väljs mellan att minska postern, flytta den under första skärmen på mobil, eller lätta kravet till uppmätt nivå. Beslutet tas inte i förväg; S1 levererar siffrorna.

### Antaganden (flaggade)
- Mobilpostern (eller h1) är LCP-elementet på `/`. Grund: CHANGELOG (RUN-257) skriver att resten av LCP hänger på att postern laddas först efter JS. Inte verifierat i Lighthouse-JSON; S1 gör det.
- Inloggade utgör majoriteten av trafiken till `/` (gruppens dagliga ingång), så en regress för dem väger tyngre än vinsten för publiken. Därför ligger hela fullappen orörd i sin routing och omdirigeringen kommer före första ritning.
- Att `Link`, `Sonner`, `next-themes` och `TooltipProvider` renderar likadant under `StaticRouter`/`renderToString` som i webbläsaren är inte provat; hydreringstestet i S4 avgör, och en provider som inte klarar det tas ur lean trädet (landningen använder varken tooltip eller toast).
- `Cache-Control: no-cache` på `landing.html` räcker (ETag-validering); ingen längre cache önskas.
- Search Console-uppföljningen i addendum 2026-10-13 gäller oförändrad; en prerender försämrar inte indexeringen.
- (Arkitektens antagande, 2026-10-19) "Blank sida" i ägarens krav avser den tomma ramen mellan att en ny sidladdning börjat och att React ritat första gången. Den lösning som kräver minst ny kod och ingen ny design är att förrendera den befintliga laddningsvyn i `index.html` och låta lean överlämningen rendera samma vy. Vill ägaren i stället ha laddaren enbart efter att JS laddats (utan förrendering i `index.html`) räcker punkt 11.1 och 11.3, men en kort tom ram före första JS-ritningen kvarstår då; det är en ändring av punkt 11 och ska i så fall sägas.

### Revisit
- **En CSP införs** (eller en säkerhetsgranskning kräver en): hasha de två inline-skripten (punkt 4) eller flytta sessionstipset till en egen fil om det kan göras utan fördröjd ritning.
- **Överlämningen efter inloggning känns långsam** (även med laddningsvyn) eller e2e/användare klagar → alternativ X (delad ingång), eller förhämtning av fullappens ingång vid Sign in-intent.
- **Laddningsvyn syns inte eller en blank ram rapporteras** (Safari/Firefox, långsamt nät) → inline `<style>` med bakgrund per `prefers-color-scheme` (risk 10) eller kritisk CSS för `.rq-shell__pending`.
- **`/legal`, direkta `/board`-laddningar eller `/login` blir publika mål** med egen LCP-budget → samma förrendering/koddelning för dem; `assertMatrix` har redan en rad per URL.
- **TBT > 150 ms efter hydrering** → selektiv hydrering (risk 2).
- **Mer än en prerenderad sida** (FAQ, blogg, publika packs) → byt det handbyggda steget mot ett riktigt SSG-verktyg.
- **S6 når inte 2 500 ms** → åtgärdslistan i risk 1 och ägarbeslut C.
- **Prestandapoängen eller LCP regredierar på `main`** efter att taken skärpts → felsök med artefakten (`docs/release.md`, "Fäller budgeten"); höj aldrig utan ägarens ok.

### Storyuppdelning (förslag till Refinern; Refinern skriver storyerna)
Spår: **logik** = bygge, server, skript, mätning, budget; **komponenter** = React/CSS i `features/landing` och `pages`. Beroenden: S1 först; S2 och S3 (komponenter) kan gå parallellt med S4 (logik), men S4:s hydreringstest kräver att S2 är klar; S5 efter S4; S6 slår på allt och kräver S2–S5 (före S6 serveras `landing.html` aldrig, så inget når användare halvfärdigt; den delen av S4 som rör `index.html` är dock synlig för alla SPA-adresser från den dag S4 deployas och måste därför vara klar och testad i S4); S7 efter minst fem gröna `main`-körningar med S6.

- **S1 (logik) Baslinje och LCP-element.** Kör `scripts/lighthouse/run.sh` mot nuvarande `main` (båda `STATS_MODE`), spara medianen och, ur rapport-JSON, `largest-contentful-paint-element`, `network-requests` (ordning och tider för entry-JS, `Index`-chunk, CSS, font, poster) och JS-bytes per fil. Skriv avsnittet "Landningens baslinje (RUN-260)" i `docs/performance.md`.
  *Observerbart:* avsnittet anger LCP-elementets selektor, start och slut för poster och ingångs-JS, och bytes för ingångs-chunken; ägarbeslut C kan avgöras med siffrorna.
- **S2 (komponenter) Landning utan JS-val på bredd.** Punkt 5. `LandingHeader`, ingress, `PackPreview`, `HowItWorks`, `ArenaTrack`, `LandingFilm` renderar båda varianterna; CSS väljer; `film`/`film-mobile`; ESLint-regeln; justerade test.
  *Observerbart:* (1) ESLint grön med regeln som förbjuder `useIsDesktop`/`matchMedia` i `features/landing`; (2) Chromium 390 px: ingen synlig nav, kort ingress, mobil bana med 3 löpare, `#film-mobile` synlig och desktopfilmen `display: none`; 1440 px: nav med tre länkar, lång ingress, 6 löpare, `#film` synlig och mobilfilmen dold; (3) `getAnimations()` ger 0 animationer för den dolda banan; (4) "Watch the film" scrollar till rätt variant vid båda bredderna; (5) `npm test` grön i frontend (uppdaterade `LandingScreen`/`LandingFilm`/`ArenaTrack`-test).
- **S3 (komponenter) Sifferrad utan skift och postern först.** Punkt 6 (ägarbeslut B); mobilpostern `loading="eager"` (komponentdelen; själva `<link rel="preload">` läggs i `landing.html` i S4); stats-felläget reserverar höjd.
  *Observerbart:* (1) `LandingStats.test`: vid fel finns raden kvar med `aria-hidden` och `visibility: hidden` (inget `null`); (2) Lighthouse CLS ≤ 0,02 i båda `STATS_MODE` på `/` (den klientrenderade sidan, före prerender); (3) i Chromium 360 och 1440 px flyttas inga andra element än talen själva (±1 px) när siffrorna anländer (`getBoundingClientRect` före/efter mockat svar); (4) Designern har godkänt eventuell ändrad fördelning.
- **S4 (logik) Lean ingång, SSR-bygge, `dist/landing.html` (ej serverad ännu) och appens laddningsvy.** Punkt 1–2, 8, 9 och 11: `landing.html`, `landing-main.tsx` (`hydrateRoot`, `installStaleChunkReload`, stagingbanner), `landing-ssr.tsx`, `scripts/prerender-landing`, lean router med `*`-överlämning som renderar `RoutePending`, lazy `LoginDialog` med intent-förhämtning, `LegalPage` lazy, `isSsrBuild`-grindar, `staticHead.test.ts` för båda filerna, hydreringstestet. **Laddningsvyn:** `App.tsx`:s `loading`-gren och `AppShell`:s odefinierade-bredd-gren byter till `RoutePending`; `.rq-shell__pending` görs tillgänglig för lean ingången utan hela skalets CSS; `index.html` får markören `<!--app-loader-->` i `#root` och `<noscript><style>` som döljer `#root`; prerender-skriptet fyller markören med `renderToStaticMarkup(<RoutePending />)`.
  *Observerbart:* (1) `npm run build` ger `dist/landing.html` vars `#root` innehåller h1-texten, "Sample pack", fyra steg och tre `—`, samt `<link rel=stylesheet>` i head och ingen `modulepreload` mot fullappens sidor; (2) `dist/` innehåller ingen SSR-bunt; (3) hydreringstest: noll `console.error`/`onRecoverableError`, DOM-noder identiska före/efter; (4) lean ingångens JS (transfererad storlek) är mätt och står i PR-beskrivningen jämfört med S1, och importgrafen ur `.vite/manifest.json` saknar `src/pages/{Board,Titles,Duels,Events,News,Log,Profile,Runner,Badges}Page` och `driver.js` (test); (5) i RTL: Sign in-klick i lean trädet öppnar dialogen (lazy) utan att landningen ommonteras (samma DOM-nod för h1); (6) stagingbygge (`VITE_APP_ENV=staging`) innehåller bannern och `noindex` i `landing.html`;
  **Laddningsvyn (ägarkrav A):** (7) RTL på lean trädet: lyckad inloggning gör att `[role=status]` med texten "Loading" inuti `.rq-shell__pending` renderas i samma commit som landningens h1 försvinner (aldrig ett läge där containern är tom), och först därefter anropas `window.location.replace` med `/board` (respektive `next`, med sökparametrar bevarade); (8) `dist/index.html`:s `#root` är identiskt med `renderToStaticMarkup(<RoutePending />)` och innehåller varken landningstext eller `<!--app-loader-->`; bygget faller om markören saknas; (9) test: `App.tsx` i `loading`-läge och `AppShell` i odefinierat-bredd-läge renderar samma markup som `RoutePending` (en definition), och `TrackLoader.test.tsx` passerar oförändrad; (10) bygg-test på `dist`: CSS som `landing.html` länkar innehåller regeln `.rq-shell__pending` men inte skalets layoutregler (`.rq-header`, `.rq-shell__top`); (11) `index.html` har `<noscript>` med `<style>` som döljer `#root` och befintliga noscript-h1:an kvar (`staticHead.test.ts` grön); (12) Chromium, JavaScript avstängt: `.rq-shell__pending` är inte synlig på `dist/index.html`.
- **S5 (logik) Sessionstips i `landing.html`.** Punkt 4: skriptgenerator, delad lagringsnyckelkonstant, inbäddning i head vid prerender, antal-inline-skript-test.
  *Observerbart:* (1) enhetstest kör skriptet för en tabell av `(token, user, search)` och kräver samma mål som `resolveLegacyRedirect` (inkl. `?tab=titles`, `?tab=okänt`, `?utm=x`, tomt) och inget `replace` utan båda nycklarna eller med blockerad lagring; (2) `landing.html` har exakt två inline-`<script>` (sessionstips, `next-themes`); (3) skriptet står före `<link rel=stylesheet>`. Laddningsvyn för det omdirigerade dokumentet kommer ur `index.html` (S4) och prövas i S6.
- **S5b (logik, RUN-335, tillagd 2026-10-19 efter integrationskritiken av S4) Sidvisningar i den lean ingången.** Fullappens `usePageviewTracking` körs bara i `App.tsx`; utan detta hade `/`, `/legal` och `/login` nådda via `landing.html` tappat sina sidvisningar och utm-attribueringen när S6 slår på. `LandingPageviews` i `LandingRoutes` återanvänder hooken och normaliseringen (`/landing` och `/landing.html` rapporteras som `/`), och `handoffState` tystar sändaren under överlämningen så att en inloggning inte ger dubbla visningar. Umami läggs in av koden, inte som tagg, så `landing.html` har fortfarande exakt två inline-skript.
- **S6 (logik) Slå på: Caddy-regeln och serveringsprov, inklusive laddningsvyn i övergångarna.** Punkt 3 och 11. `Caddyfile`, `verify-static-serving.sh` (nya kontroller), `apps/e2e/tests/landing.spec.ts` (mot staging, Playwright finns), README i `features/landing` och `docs/release.md` kort.
  *Observerbart:* `verify-static-serving.sh` grön med: `/` → 200, `text/html`, `cache-control: no-cache`, kroppen innehåller `landing-title` och inte en tom `#root`; `/?tab=titles` och `/?utm_source=x` → samma fil; `/titles`, `/login`, `/runner/x` → `index.html` med `#root` som innehåller **bara** laddningsvyn (`rq-shell__pending`, ingen landningstext); ett bygge utan `landing.html` ger `/` = `index.html` (200, ingen 404). E2E (staging): utloggad `goto('/')` med JavaScript avstängt visar h1 i DOM; animationernas `startTime` är oförändrat före/efter hydrering (`document.getAnimations()`); inloggad användare (seedad lagring) slutar på `/board` utan att `.rq-landing` någonsin varit synlig (MutationObserver via `addInitScript`); inloggning från `/` slutar på `/board` (befintliga `login.spec.ts` grön); `/login` direkt visar landning + dialog. Lighthouse-jobbet (icke-blockerande) körs och artefakten visar förrenderad `/`.
  **Laddningsvyn (ägarkrav A), e2e mot staging med fördröjd ingångs-JS** (Playwright `page.route` fördröjer fullappens `/assets/index-*.js` med 2 000 ms; en `addInitScript` loggar per bildruta, från `DOMContentLoaded`, `{ rootBarn, laddare: !!#root .rq-shell__pending [role=status], board: !!inloggad skalvy }` och rapporterar loggen): (13) inloggning från `/` med giltigt konto: efter att URL:en bytt till `/board` är `.rq-shell__pending [role=status]` synlig (`toBeVisible`) inom 500 ms medan JS-filen fortfarande är fördröjd, `.rq-landing` finns inte i DOM, och när Board ritats försvinner laddaren; (14) i loggen finns **ingen bildruta** efter `DOMContentLoaded` där `rootBarn === 0` eller (`laddare === false` och `board === false`), alltså ingen blank sida mellan inloggning och Board; (15) samma prov för inloggad användare med seedad lagring som går till `/` (sessionstipset): laddaren synlig, `.rq-landing` aldrig synlig, loggen utan blank ruta; (16) samma prov för direktladdning av `/board` och `/legal` (laddaren synlig före JS); (17) manuellt på staging i Safari och Firefox: ingen blank vit ram mellan Sign in och Board, eller ett noterat undantag enligt risk 10; (18) skärmläsare: laddaren har `role="status"` och text "Loading" (testas som i `TrackLoader.test.tsx`).
- **S7 (logik) Skärp Lighthouse-budgeten efter resultatet.** Punkt 10. `lighthouserc.json` med `assertMatrix`, `scripts/lighthouse-ci.test.mjs` (golv/tak uppdateras bara åt skärpning), `docs/release.md` (tabell + utgångsvärden), `docs/performance.md` (resultat före/efter).
  *Observerbart:* tabellen i `docs/release.md` anger nya tak med uppmätt median per rad (≥ 5 CI-körningar, båda lägena); `/` har egna rader, `/legal` oförändrade rader med uppmätt median före/efter laddningsvyn i `index.html`; `node --test scripts/lighthouse-ci.test.mjs` grön; LCP-taket är 2 500 ms eller, om målet inte nåddes, uppmätt × 1,1 med öppen rad i `docs/performance.md` som säger det; en planterad regression (t.ex. en kopia av `dist` där `landing.html` tas bort så att `/` faller tillbaka på `index.html`) fäller jobbet i blockerande läge.
