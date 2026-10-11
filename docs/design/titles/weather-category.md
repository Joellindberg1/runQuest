# Titles — kategorin "Weather" (RUN-101, snabbspår)

Snabbspår: befintligt designspråk täcker det. Ingen Claude Design-loop, ingen Council, ingen ny referensbild — referensen är en befintlig ram (nedan).

## Referens (förlaga)

Weather är en vanlig kategorigrupp (dragspelsrubrik + titelkort) — samma komponenter som alla andra grupper, ingen ny layout.

| Yta | Förlaga i prototypen | Vad som kopieras |
|---|---|---|
| Mobil | `RunQuest App Prototype.dc.html`, skärmen Titles (`mTitles`, rad 513–599), gruppen **Time of day** (data rad ~1853–1860) — tre kort, en egen ikon per kort, blandat mine/held | Rubrikrad (ikon · VERSALER · "3 titles"), kort i enkel kolumn med 3 px vänsterkant, namn · regel · innehavarchip + värde · runner-ups |
| Desktop | `RunQuest Web Prototype.dc.html`, sidan Titles (`isTitles`, rad 563–652), samma grupp **Time of day** (data rad ~1958–1966) — tre kort i `grid 3 × 1fr` | Rubrikrad med chevron efter antalet, tre kort på en rad (exakt en full rad) |
| Tomt läge | Samma ramar, kortet **The Commuter** i gruppen Volume (mobil rad ~1874, web rad ~1980) — streckat "nobody yet", värde "—", "Best so far · namn värde" | Olåst-kortet |

Implementationen (`titles.css`, `TitleGroupSection`, `TitleCard`) ritar redan allt detta. Prototyperna ritar bara fyra grupper (Time of day, Distance, Volume, Consistency); Pace/Elevation/Comeback/Other saknar också egen ram — samma precedens, Weather följer gruppmallen.

## Vad som skiljer (all data, ingen ny stil)

- **Rubrik:** `Weather` (versaler via CSS), räknare "3 titles". Gruppen ligger **före "Other"** (efter Comeback) i `TITLE_CATEGORIES`. Stängd som standard (bara första gruppen är öppen i All-vyn); öppen när ett filter är aktivt. Tom grupp (filter utan träff) utelämnas som idag.
- **Grupp-ikon (antagande, flaggas):** `sun` — den är den enda väder-ikonen som inte redan är en annan grupps rubrikikon (Pace=`zap`, Time of day=`clock`). Alternativ om ägaren vill annat: `globe`.
- **Tre kort, titelikoner:** Stormborn `zap` · Iceborn `snow` · Winter Warrior `snow`. Ikonen följer vanliga regeln: guld när jag håller titeln, annars dämpad text-4.
- **Värdeformat** (via `titleFormat`, ny rad per mått): Stormborn och Iceborn `N runs` (som Batman/Rooster), Winter Warrior `N.N km` (som Weekend Destroyer, 38.4 km). Samma format i innehavarrad, runner-ups, Best so far, "Unlocks at", Closest chase och Runner card/Profile.
- **Regeltexten** är `titles.description` ordagrant ur databasen (inga titeltexter i koden). Kort med 1–2 raders regel; `min-height` för regelraden är redan satt.
- **Tomt läge före omräkning:** alla tre är olåsta tills titelomräkningen körts: streckat chip "Nobody yet", värde "—", vänsterkant neutral. "Best so far · namn värde" visas bara när group-eligibility har ett värde > 0 för måttet — före omräkning är värdena 0, så då visas bara "Nobody yet" + (om kravet > 0) "Unlocks at N runs / N km". Inget felkort, ingen skeleton, ingen "0".
- **Filter:** Unclaimed visar Weather med alla tre före omräkning; Mine visar bara de jag håller.

## Inga nya tokens eller ikonfiler

- Alla stilar finns i `titles.css` mot befintliga `--rq-*`-tokens; inga råvärden, ingen ny sektion i temafilen.
- `zap`, `snow` och `sun` finns i `docs/design/claude-design/runquest-icons.js` (rad 31, 35, 26) och i appens port `apps/frontend/src/shared/components/icons/rq-icon-paths.ts` (rad 30, 34, 25) — ingen ikon läggs till.

## Byggnotis (kod, inte design)

`TitleCategoryId` + `TITLE_CATEGORIES` får `weather` (före `other`); en rad per ny `metric_key` i `titleCategories.ts` OCH `titleMetricKeys.fixture.ts`, annars fäller `titleCategories.test.ts` (titlar utan rad hamnar i Other). Nya mått behöver en rad i `formatTitleValue` (annars visas bara talet, utan enhet). Bygget ska hålla sig till titles/README.

## Status

| Vy | Status |
|---|---|
| Titles — grupp "Weather", mobil | **KLAR** (referens = App Prototype, skärmen Titles, gruppramen "Time of day"; tomt läge = kortet "The Commuter") |
| Titles — grupp "Weather", desktop | **KLAR** (referens = Web Prototype, sidan Titles, gruppramen "Time of day"; tomt läge = kortet "The Commuter") |

Öppet: gruppikonen `sun` är ett motiverat antagande (se ovan), inget blockerande.
