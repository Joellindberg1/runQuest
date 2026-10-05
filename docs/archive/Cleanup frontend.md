# Frontend cleanup 
## App & Main
### Main
- Mountar React-appen
- Initierar providers (Auth, Query, Tooltip, Theme)
- Innehåller *ingen logik eller layout*
### App
- Bara hanterar **Routing**
- Importerar `pages/` men ingen logik direkt
- Har ingen direkt UI (allt UI via pages/features)
### Flytta affärslogik från App
- Flytta eventuell affärslogik från App → respektive feature
### Providers mapp
- Lägg providers i egen mapp /src/providers om du vill hålla Main supersmal
## Pages
### Pages mapp
- Skapa en pages/-mapp med en page per route (ex: DashboardPage.tsx, SettingsPage.tsx osv.)
### Pages - Logik
- Flytta eventuell logik ut ur pages → tillhörande features
### Importera features - Pages
- Importera features i varje page:
    - Ex: **`DashboardPage`** importerar **`LeaderboardFeature`**, **`ProfileFeature`**, **`RunLoggerFeature`**
### Structure - Pages
•  Använd pages enbart för att strukturera layouten och ordna features
### Kontrollera UI Layout per page
•  Kontrollera att varje page returnerar ett tydligt UI-layout-block (card/grid osv.)
### Feature first check - Pages
- Lägg endast *lätta components* här (ex: page-header, container)
- Andra components ska ligga direkt i features istället.
## Features
### Feature mapp
Skapa

```
/src/features/
```

- mappen med en mapp per feature

Ex:

features/
├─ leaderboard/
│   ├─ components/
│   ├─ hooks/
│   ├─ utils/
│   ├─ index.ts
│   └─ LeaderboardFeature.tsx

Fixa features in i den nya mappen där det är färdigt och fint istället för att hålla på med den gamla. Bör vara lättare att göra förändringarna utan stora problem för programmet då.
### Pages / Features
- Se till att features är i features mappen och pages är separerade
    - En feature är aldrig bara en feature, en page bör vara flera features  och components.
    - T ex footer och header är shared components, dem ska aldrig in i en feature, dem ska in i pages och där ska feature också in.
    - Är det bara en feature så gör vi på detta sättet ändå.
    - Seperation of concern
### Components - Feature
- Se till att Componenbts som endast hör till en feature läggs in i den featurens mapp och sen i en egen components mapp där i. Tydlighet. 
### Shared components - Feature
- Lägg gemensamma komponenter i shared/components
### Index - Feature
- Skapa ett **`index.ts`** i varje feature för enklare import
- Kolla upp varför man ska göra en index.ts för enklare import, vad gör detta faktiskt?
### Custom hooks etc - Feature
- Säkerställ att feature-komponenterna hanterar:
    - API-anrop (via services)
    - State (via hooks eller context)
    - Rendering av sitt innehåll
### Feature ReadMe's 
- Lägg till README i varje feature-mapp med syfte och dependencies
  - Låg prio, men ingen dum idé för när projektet växer och jag kanske inte arbetar med en feature på väldigt länge, då kan det vara bekvämt att kolla tillbaka på en readMe
  - En mall för alla kan vara bra så att man läser igenom alla på samma sätt.
### Dubletter - Shared components
Rensa bort dubbletter (t.ex. gamla versioner av Leaderboard)
Detta gäller alltså shared och feature, kolla igenom ifall det är så att några feature components kanske ska vara shared osv.
## Shared & UI Components
### Flytta komponenter
- Flytta alla gemensamma komponenter till /shared/components
### ./UI- Shared
- Håll /ui reserverad för Shadcn primitives (buttons, cards, dialog, form, etc.)
### Dubletter - Shared componments 
( Kolla feature kapitlet)
### Generic components
Se till att alla UI-komponenter är generiska och feature-oberoende

Generiskt först sedan ändrar vi och customizar vi det i featuren eller annat. Om det är så att någonting är för annorlunda, kan vi bryta ned det ytterligare?
### Buisness logic - Shared
- Kontrollera att `/shared` inte innehåller affärslogik – endast UI och enklare helpers
- Shared components ska aldrig innehålla logik
- Logiken ska alltid köras på featuren, feature component eller custom hooks etc. 
- Man kan riskera att få in logik på ställen där man inte vill ha den om man inte tänker sig för .
## Service and logic seperation
Allt nedan ligger under title 2 rubrik då det inte är separerat än, se längre ner på kapitlet. Jag vill kika igenom saker innan vi skapar substasks eller löser detta kapitlet så att det blir rätt mot backend. 
- Se till att alla API-anrop ligger i **`/src/services/`**
- Konsolidera service-filer (ex: **`runService`**, **`titleService`**)
- Flytta duplicerad XP-beräkning till en central plats (**`xpCalculationService`**)
- Kontrollera att features endast använder service-funktioner – aldrig fetch direkt
- Se till att **`/services`** är helt backend-agnostiskt

Innan vi ser över ovan punkter så måste vi kolla hur detta fungerar med backenden och kolla vad som ens ska vara kvar så vi inte skapar saker som jobbar och gör samma sak som backenden fast på ett annat sätt så vi får fel data som displayas. 

När bekräftat så blir denna task klar eller så gör vi subtasks på ovan.
## Cleanup and konsolidering
### Cleanup legacy
- Ta bort optimizedLeaderboard och optimizedTitleSystem (legacy)
### Cleanup hooks
- Ta bort gamla hooks (LoginContext, UserDataContext) om de inte används - Backenden har tagit över mycket så dags att se över detta. 
### Import paths
Verifiera att import paths använder `@/*` alias

 Rensa bort oanvända imports och console.logs

Se över vad ovan menas med, men att kolla över import paths kan vara bra ändå så att det inte ligger kvar mycket gammalt då det tar onödig kraft.
### ReadMe Uppdatering
- Uppdatera README med ny struktur och syfte
## Testing % QA
### Test cleanup
- Ta bort gamla, tomma testfiler
### Jest/RTL test
- Lägg till enklare Jest/RTL-test för varje aktiv feature
- Vad gör detta? 
### ESlint regler
- Uppdatera ESLint-regler så att den följer feature-first-konventioner
### Server test
- Kör `npm run lint` + `npm run build` och säkerställ inga warnings
Mycket förändringar så kolla igenom ovan
### Console cleanup
- Kolla igenom alla console.logs för att se vad som faktiskt behövs. Det är väldigt stökigt i devtools och console just nu. En del saker kan faktiskt vara bra att tracka där och en del saker ska absolut inte vara där under produktion. 
## Slutkontroll
### Routing och feature test
- Starta dev-server → Kontrollera routing & feature-laddning
### Visuell testning
- Visuell testning: Dashboard, Settings, Titles, Admin
### Run build test
- Kör npm run build utan fel
### Dokumentation
- Dokumentera ny struktur i FeaturesPage / Changelog