# 009. Badgesystem — härledda, återkallbara badge-serier med sex tiers (Jira RUN-1, v0.6.0)

## Status
Godkänd av ägaren 2026-10-11. Reviderad 2026-10-11 efter ägarbeslut (sex nivåer; tid på dygnet = löparens lokala väggklocka) och Lead-beslut (rekommendationerna i första utkastet antagna; ägaren kan invända vid ADR-granskningen). Migration 035 kräver ägarens uttryckliga godkännande (docs/permissions.md, ADR 002).

## Kontext
Epic RUN-1 (fixVersion v0.6.0), story RUN-2 "Badges-system" (designfasen). Badges är något användare samlar på sig utanför titlarna: flera kan ha samma badge samtidigt (titlar har en innehavare), man väljer själv vilka man visar, och man ser bara den bästa nivån man har i en serie. Detta är första ADR:n för badges; ADR 008 reserverade uttryckligen en framtida typ `badge_earned` i activity_log.

Verifierat i koden 2026-10-10/11 (main 89149e1):

- **Ägarens prototyp `badges-playground.html`** (repo-roten) är underlaget för trösklar och visning. Det jag tar därifrån: (a) 10 serier × 6 tiers = 60 badges, tierna Common / Uncommon / Rare / Heroic / Epic / Legendary med färg + glow per tier (`LEVELS`, `LEVEL_FILLS`); (b) tröskeltexterna (`BADGES`-listan, fältet `req`); (c) "Player Card" med max 3 visade badges (`state.playerCard`); (d) uppgraderingspopup ("Badge Evolved!"); (e) en badge = tierram (SVG-form) + serieikon (emoji), alltså 10 serieikoner + 6 ramar, inte 60 bilder. Det jag **inte** tar: de hårdkodade `percentile`-talen ("Top 78 % of users" — påhittade, och "Top 78 %" för Common är semantiskt bakvänt), popupens `percentile * 0.35`-uträkning och knapptexten "Claim Reward" (badges ger ingen belöning, beslut 5).
- **Epicens text nämner tre nivåer** (Common / Rare / Legendary) under "Tidigare beslut". **Ägarbeslut 2026-10-11: sex nivåer som i prototypen.** Epicens tre-nivåtext är därmed föråldrad.
- **Data finns** för 9 av 10 serier. Kolumner i `runs` (000_baseline.sql): `distance numeric(6,2)`, `date`, `start_time timestamptz` (endast Strava), `moving_time` (Strava), `total_elevation_gain` (Strava), `is_treadmill`, `start_lat/start_lng`. **Manuella rundor har ingen `start_time`** och räknas därför inte i tidsserierna (Early Bird, Night Owl). `run_weather` finns bara för utomhusrundor med koordinater och kan landa EFTER `calculateUserTotals` (`WeatherService.backfillMissingWeather()` körs i 30-minuterscronen efter synken, `scheduler/stravaSync.ts`). Streak: `users.longest_streak` skrivs av `calculateUserTotals` ur `StreakService`.
- **`runs.start_time` är löparens lokala väggklocka, inte en UTC-tidpunkt.** Den fylls med Stravas `start_date_local` (`routes/strava.ts:71`, `extractExtendedFields`). Strava skickar värdet formaterat med ett falskt 'Z' fast det är lokal klocktid, och det lagras i en `timestamptz`; `getUTCHours()/getUTCMinutes()` på `start_time` ger därför löparens klocktid på platsen där hen sprang. Det är avsiktligt och rätt, och titelmotorernas `utcMinutes` (`earlyRunCount`, `nightRunCount`) läser det på samma sätt. **Ägarregel: tid på dygnet = löparens egen lokala tid i stunden — inte serverns, inte någon annans.** Badges läser därför `start_time` med UTC-getters och konverterar aldrig (varken till Stockholm eller annan zon); en konvertering skulle förskjuta 1–2 h och vara fel för en löpare utomlands. (Min första version av utkastet missförstod detta och föreslog Stockholm-konvertering; det är borttaget.)
- **Skrivvägen:** alla runda-skrivningar (POST/PUT/DELETE `/runs`, Strava-import, admin) slutar i `calculateUserTotals` (ADR 005, enda skribent). ADR 008 etablerade mönstret "observatör efter lyckad totalskrivning, icke-kastande, jämför mot föregående" (`recordLevelUps`, `recordRunMilestones`). Strava-importen hämtar väder FÖRE `calculateUserTotals` (`routes/strava.ts` ~r.821–825).
- **Titelmotorerna** (`apps/backend/src/titleEngines/`, 21 st, registry på `metricKey`, `calculate(runs, userStats) => number`) rankar "bäst i gruppen". Skäl att inte återanvända instanserna: (1) de returnerar ett rankningsvärde (`fastest5km` = 60 − minuter, −9999 när saknas), badges behöver tröskeljämförelse med riktning; (2) `unlock_requirement` ligger i DB per titel, badge-trösklar ska ligga i kod; (3) shared kan inte importera backend. Titlarnas tröskel + återkallelse (#10, ADR 005) är däremot exakt den livscykel badges ska ha, och väggklockeläsningen (`utcMinutes`) återanvänds som semantik.
- **Titelleaderboarden är global och `GET /titles/user/:userId` saknar gruppkontroll** (STATE zon 8). Badge-endpoints får inte kopiera det mönstret (se Strava-hållningen).
- **`users.displayed_title_ids text[]`** (migration 009) är precedensen för "man väljer själv vad som visas"; **`user_titles`** är precedensen för att lagra härledda gamification-fakta ur rundor (en rad per användare × titel, återkallas när kravet inte uppfylls).
- **ADR 001:s in-memory-fake av Supabase (`test-utils/fakeSupabase.ts`) är ännu inte byggd** (mappen är tom, STATE zon 9). Beslut 11 bygger inte på den.
- Migrationer: 034 är senaste filen i repot och applicerad (ADR 008 addendum). Nästa nummer är därmed **035** — verifieras mot `list_migrations` före apply (ledgern kunde inte läsas i skrivsessionen).
- Det finns EN aktiv grupp med 6 användare.

**Ägarens Strava-hållning (2026-10-07, bindande):** ingen AI på Strava-data inklusive härledd data; Strava-data visas bara inom gruppen användaren själv anslutit sig till; inga analyser/statistik över användare på Strava-data utöver appens spelmekanik; raderingar via webhooks (inte byggt än); lagring orörd tills kapacitetsansökan. Hur ADR:n följer den är beslut 9.

Relaterade ADR:er: **004** (rena funktioner + delad SSOT i `packages/shared`), **005** (`calculateUserTotals` enda skribent; titlar återkallas), **007** (svarsform/kontrakt), **008** (activity_log; typen `badge_earned`; observatörsmönstret), **003** (routern monteras i `createApp()`), **002** (migrationsflödet), **001** (teststrategi). Ingen ADR ersätts; 008:s typlista utökas additivt.

## Beslut

### 1. Datamodell
**Definitionerna bor i kod, inte i DB.** `packages/shared/src/badges.ts` (SSOT, ADR 004-mönstret) innehåller serielistan, tier-reglerna, tiernamnen och kravtexterna; backend och frontend delar den. Skäl: trösklarna är justerbara konstanter utan admin-UI, frontend behöver dem ("nästa nivå kräver …"), och en definitionstabell skulle kräva migration/seed per justering.

**Sex tiers (ägarbeslut):** 1 Common, 2 Uncommon, 3 Rare, 4 Heroic, 5 Epic, 6 Legendary (`MAX_TIER = 6`, namnen i en visningstabell).

**Användarens badges: en rad per (användare, serie) = bästa tier just nu** — "man ser bara den bästa rarityn man har på en badge" blir en strukturell egenskap. Samma kategori av lagring som `user_titles`.

Migration `035_create_user_badges.sql` (additiv/expand, ADR 002-flödet):

```sql
create table if not exists public.user_badges (
  user_id       uuid        not null references public.users(id) on delete cascade,
  series        text        not null,                  -- 'early_bird' … (nyckel ur shared; ingen CHECK, nya serier = ingen migration)
  tier          smallint    not null check (tier >= 1),
  seen_tier     smallint    not null default 0 check (seen_tier >= 0 and seen_tier <= tier),  -- popup-vattenmärke (beslut 5)
  earned_at     timestamptz not null default now(),    -- när NUVARANDE tier uppnåddes
  source_run_id uuid        references public.runs(id) on delete set null,  -- rundan som gav tiern (endast enrundsserier), för felsökning
  updated_at    timestamptz not null default now(),
  primary key (user_id, series)
);
alter table public.user_badges enable row level security;   -- inga policyer = ingen åtkomst utom service role
revoke all on public.user_badges from anon, authenticated;

-- Visade badges: samma mönster som displayed_title_ids (migration 009); atomisk enradsuppdatering.
alter table public.users add column if not exists displayed_badge_series text[] not null default '{}';
alter table public.users add constraint users_displayed_badge_series_max3 check (cardinality(displayed_badge_series) <= 3);

-- Typen badge_earned till händelseloggen (ADR 008 beslut 11.1: additiv CHECK-utökning)
alter table public.activity_log drop constraint activity_log_type_check;
alter table public.activity_log add  constraint activity_log_type_check check (type in (
  'title_unlocked','title_taken','title_revoked',
  'challenge_received','challenge_won','challenge_draw',
  'level_up','run_milestone','streak_broken',
  'event_open','event_closed','badge_earned'));
```
- **Ingen `value`/progress-kolumn i v1.** Tier-reglerna använder olika mått per tier i flera serier, så ett enda lagrat värde vore missvisande; prototypen visar bara kravtexten. Omprövas om designen vill ha progressbar.
- `seen_tier <= tier` (CHECK) tvingar fram att nedgradering skriver båda kolumnerna i samma `update`.
- `source_run_id` är `on delete set null`: en badge-rad ska aldrig blockera radering av en runda (jfr `event_entries.run_id`, NO ACTION, ADR 008 addendum 5).
- Inga Strava-id:n, koordinater eller råvärden lagras: tier, tidpunkter, run-referens.

### 2. Beräkning: härledd, idempotent omräkning efter varje skrivning, egen motor
- **`computeBadgeTiers(runs, stats)`** är en ren funktion i `packages/shared/src/badges.ts` (ingen I/O, data som argument — ADR 004/001): indata `BadgeRun[]` (`id, date, distance_km, start_time, moving_time, total_elevation_gain, is_treadmill, source`; väder ingår inte förrän Weathered Soul byggs) + `{ longest_streak }`; utdata per serie `{ tier: 0..6, source_run_id? }`. **Tier = högsta tier vars regel är uppfylld** (reglerna behöver inte vara nästlade).
- **Tid på dygnet läses som väggklocka:** `wallClockMinutes(start_time)` läser HH:MM direkt ur strängen (samma semantik som titelmotorernas `utcMinutes`; en sträng med annan offset konverteras aldrig), **ingen tidszonskonvertering någonsin** (se Kontext). Rundor utan `start_time` (manuella) räknas inte i tidsserierna.
- **Egen motor, inte titelmotorerna** (skälen i Kontext). Mönstret återanvänds: registry på nyckel, ren `calculate`, kontraktstest (ADR 001).
- **Orkestrering `evaluateBadges(userId)`** i `apps/backend/src/services/badgeService.ts` (icke-kastande, ADR 008-mönstret): läser rundorna (+ `run_weather` när en väderserie är aktiv) och `users.longest_streak`/`group_id`; kör `computeBadgeTiers`; läser befintliga `user_badges`; ren `diffBadgeTiers(existing, computed)` ger `{inserts, upgrades, downgrades, deletes}`; skriver bara skillnaden (omkörning utan ändring = noll skrivningar → idempotent). Orkestratorn tar en **store-port** (`loadRuns/loadBadges/writeDiff`) med en tunn Supabase-adapter så att den kan beteendetestas utan den obyggda fake-klienten.
- **Anropspunkt:** en rad i `calculateUserTotals`, efter att totalerna sparats och loggraderna skrivits, före titelbearbetningen: `await evaluateBadges(userId)`. Därmed täcks POST/PUT/DELETE `/runs`, Strava-import (väder redan hämtat) och admin utan att röra skrivvägarna. Rundorna läses i en egen query i badgeServicen; `calculateUserTotals`-selecten ändras inte (zon 1: minimal diff).
- **Återkallelse: badges är RE-BERÄKNADE, alltså återkallbara** (Lead-beslut). Raderas eller ändras en runda så att kravet inte längre uppfylls sjunker tiern (`update`, `seen_tier = least(seen_tier, tier)`) eller raden raderas (tier 0). Skäl: (1) samma livscykel som titlarna sedan #10 och ADR 005:s princip att hela gamification-tillståndet följer löphistoriken; (2) en permanent badge byggd på en raderad Strava-aktivitet vore kvarhållen härledd data, i strid med hållningen att raderingar ska slå igenom; (3) ett "high-water mark" är ett andra sanningsställe som inte kan återskapas ur rundorna (backfill blir inte idempotent). Pris: en användare kan tappa en badge genom att ändra/radera en runda — samma sak som gäller XP och titlar.
- **Race:** två samtidiga utvärderingar för samma användare kan i teorin skriva i fel ordning; PK `(user_id, series)` + omräkning vid nästa skrivning läker (samma accepterade modell som ADR 005). Ingen extra låsning.
- **Aldrig mer än spelmekanik:** inga regler eller texter genereras av AI/ML; reglerna är deterministiska och enhetstestade.

### 3. Trösklar per serie och tier
**Revision v2 (ägarbeslut 2026-10-11, RUN-135).** Startvärdena ur `badges-playground.html` ersattes efter dry-run mot prod. Badges samlas över flera säsonger och resettas inte som titlarna. Därför gäller:
- **En mätning per serie.** Alla sex tiers mäter samma sak med samma fönster (`uniformTiers` i shared).
- **Strikt stigande.** Legendary kan aldrig nås före Epic.
- **Fokus ska löna sig.** En specialist når toppen på 2–3 år, gruppens bästa i dagens takt på 5–6 år.

Konstanterna bor i `packages/shared/src/badges.ts` och ändras utan migration. Strikt jämförelse där texten säger "under". "Väggklocka" = `start_time` läst enligt beslut 2. Fönstren är halvöppna `[start, slut)`.

| Serie (`series`) | Mått | Tier 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|---|
| Milestoner (`milestoner`) — längsta enskilda runda | km, ≥ | 5 | 10 | 21,1 | 30 | 42,2 | 50 |
| Earth Trotter (`earth_trotter`) — total distans | km, ≥ | 100 | 300 | 1 000 | 2 000 | 3 000 | 5 000 |
| Climber (`climber`) — total höjdmeter (bara Strava-rundor har höjd) | m, ≥ | 500 | 1 345 | 4 808 | 8 848 | 17 696 | 26 544 |
| Streak Keeper (`streak_keeper`) — längsta svit (samma källa som `users.longest_streak`) | dagar, ≥ | 7 | 14 | 50 | 100 | 365 | 730 |
| Early Bird (`early_bird`) — rundor med start 04:00–06:59 (väggklocka) | st, ≥ | 5 | 20 | 50 | 100 | 200 | 300 |
| Night Owl (`night_owl`) — rundor med start 21:00–03:59 (väggklocka) | st, ≥ | 5 | 20 | 50 | 100 | 200 | 300 |
| Speedster (`speedster`) — bästa 5 km-tid (runda 4,9–<10,0 km, råa `moving_time`; samma kvalificering som titeln `fastest5km`) | min, < | 35 | 30 | 25 | 22 | 20 | 18 |
| Precisionist (`precisionist`) — **Strava-rundor** på exakt helt km (distans ≥ 1 och 2 decimaler = .00) | st, ≥ | 5 | 20 | 50 | 100 | 200 | 300 |
| Weathered Soul (`weathered_soul`) — *skjuten, beslut 8* — "blöt" = `weather_code ≥ 51`, "kall" = `temperature_c` | st, ≥ | 1 blöt eller < 10 °C | 10 blöta eller < 10 °C (tiernamn **"Squall Runner"**, se not) | 1 runda < 0 °C | 10 rundor < 0 °C | 1 runda < −10 °C | 10 rundor < −10 °C |
| Socialite (`socialite`) — *skjuten, beslut 6* | – | – | – | – | – | – | – |

Vad v2 ersatte (startvärdena):
- **Blandade mätningar.** Early Bird, Night Owl och Precisionist bytte mått eller fönster i tier 5–6, t.ex. Night Owl 6 = "10 rundor 23:30–00:30" och Precisionist 6 = "exakt 10,00, 21,10 och 42,20 km". Det gjorde att en högre tier kunde nås före en lägre. Nu gäller en mätning per serie.
- **Precisionist räknar bara Strava-rundor** (ägarbeslut). Manuella rundor kan skrivas in på exakt helt km och ska inte kunna "mata in" serien. Mätningen heter `exact_km_strava_runs` och bygger på `BadgeRun.source`. RUN-136 gör att POST `/api/runs` alltid sätter `source = 'manual'`.
- **Toppnivåerna** är skalade för flera år: Earth Trotter 10 000 → 5 000 km, Climber till Everest ×3 och Streak Keeper till två år.
- **Namnkrock:** prototypens Weathered Soul tier 2 heter "Storm Chaser", vilket krockar med eventmallen Storm Chaser (v0.5.3, vind ≥ 15 m/s). I ADR:n heter tiern **"Squall Runner"**; slutligt namn sätts av Designern när serien släpps.
- **Väder-not (skjuten serie):** `WeatherService` räknade tidigare rundans ålder som om `start_time` vore en UTC-tidpunkt. Rättat i RUN-106 (2026-10-11): åldern räknas via `wallClockToInstantMs` (shared), timmatchningen mot Open-Meteo läser väggklockan.

Antaganden (konstanter i shared):
- (a) Fönstren för Early Bird och Night Owl är Leads val. Prototypen säger bara "före 07:00" och "efter 21:00".
- (b) 5 km-tiden jämförs mot råa `moving_time` för rundor 4,9–<10,0 km (samma regel som titeln).
- (c) Löpband räknas som för XP, utom där data saknas (väder, höjd, starttid).
- (d) Manuella rundor räknas som för XP i Milestoner och Earth Trotter. De går därför att "mata in", samma exponering som XP har i dag. Manuella rundor räknas inte i tidsserierna eller i Precisionist.
- (e) "Blöt" mäts via `weather_code`, modellens sammanvägda bedömning av rundtimmen.

### 4. Visning (designen ägs av Designern i RUN-2; ADR:n fastställer data och platser)
Tre platser, alla gruppavgränsade:
1. **Profil (egen):** hela samlingen — upplåsta serier med tier, låsta serier med kravtexten för nästa tier — samt val av visade badges (max 3).
2. **Runner card (andras profil, i samma grupp):** deras samling och valda badges.
3. **Leaderboard/Board-rader:** användarens valda badges (max 3, kompakt).
Samma 3 valda visas på alla platser (antagande; separat uppsättning är YAGNI). Frontend får inga nya hårdkodade visuella värden; glow/tierfärger följer tokenspåret Designern fyller (`rqGlowIcon` i index.css är förberett). Ingen kod byggs mot prototypens CSS.

**API** (ny router `routes/badges.ts` på `/api/badges` i `createApp()`-listan; ADR 007 A: `{success,data,meta?}`/`{error}`, snake_case, typer i `packages/shared/contracts`):
- `GET /api/badges/user/:userId` — `data: { items: [{series, tier, earned_at, seen_tier?}], showcase: string[] }`. `seen_tier` returneras bara för anroparen själv. **404 om målet inte är i anroparens grupp** (aldrig 403, ingen existensläcka).
- `GET /api/badges/group` — `data: { members: [{ user_id, showcase: [{series, tier}] }], holders: { <series>: { <tier>: antal_i_gruppen_med_tier_eller_högre } } }`, `meta: { member_count }`. Ger Board-raderna och "X av N i din pack"; rör inte `auth.ts`/`users-with-runs` (zon 10).
- `PUT /api/badges/showcase` — body `{ series: string[] }`: ≤ 3, unika, kända, **ägda** av anroparen, annars 400. Skriver `users.displayed_badge_series` (en `update`, atomisk). Läsvägen skär alltid mot ägda serier, och `evaluateBadges` rensar en serie ur arrayen när raden raderas.
- `POST /api/badges/seen` — body `{ series?: string[] }` (utan = alla): sätter `seen_tier = tier` för anroparens rader. Idempotent; sänker aldrig.

### 5. Uppgradering: popup och news (kosmetiskt — ingen belöning)
- **Badges ger ingen XP och inga tokens** (Lead-beslut; reglerna rörs inte, skrivvägen öppnas inte). Prototypens popup-knapp "Claim Reward" byts mot text utan belöningslöfte ("Got it"; slutlig text sätts av Designern).
- **Popup:** drivs av `tier > seen_tier` ur `GET /api/badges/user/<jag>`. Ingen push behövs: Strava-synken sker i cron när användaren inte är där, så popupen visas nästa gång appen öppnas eller efter att en runda loggats och badge-queryn invalideras. En popup per serie (högsta nya tier), kö vid flera; avfärdande anropar `POST /badges/seen`. **Backfill och `--silent`-körningar sätter `seen_tier = tier`** → ingen popup-flod vid utrullning eller retuning.
- **News:** ny `ActivityType` `badge_earned` (payload v1: `series, tier, previous_tier | null`; actor = användaren, ingen target). Dedupe-nyckel `badge_earned:<userId>:<series>:<tier>` (första gången tiern nås — som `level_up`). Skrivs via `recordActivities` efter lyckad `user_badges`-skrivning (best-effort, ADR 008 beslut 4); gruppen ur `users.group_id`. Backfill skriver **inga** news-rader. **Vid nedgradering/radering retractas `badge_earned`-raderna för de förlorade tierna** (`retractActivity`, deterministiska nycklar) så flödet inte visar en badge som inte finns och raderade Strava-rundor inte lever kvar i flödet. Kräver `ACTIVITY_TYPES` + CHECK (migration 035) + en rad i frontendens news-modell (exhaustive switch i `newsModel.ts`, chip-mappning). Första kandidaten att skjuta om v0.6.0 trängs.
- `run_milestone` (100/250/500/1000/2500/5000 km, ADR 008) och Earth Trotter (100/300/1 000/…) överlappar delvis och kan ge två news-rader samtidigt. Accepterat; Designern avgör renderingen.

### 6. Socialite skjuts till en senare epic/story
Socialite kräver att gemensamma rundor upptäcks, vilket är en annan sorts funktion: (1) **korsanvändar-beroende** — A:s badge ändras när B loggar eller raderar en runda, så utvärderingen måste köras för hela gruppen och återkallelse kan drabba någon som inte själv gjort något; (2) prototypens definitioner är **dag-baserade** ("samma dag som 1/3/5 andra") — med 6 användare vanligt utan att man sprungit tillsammans — medan epiken talar om GPS-start + tid, vilket betyder att jämföra användares startkoordinater, en analys över Strava-data nära gränsen i hållningen; (3) tier 5–6 ("få andra att springa") mäter andra användares beteende. Beslut: ingen Socialite i v0.6.0. Definitionen (dag-baserad utan GPS = enklast och Strava-säkrast; tid+plats = meningsfullare men kräver Strava-bedömning) väljs när den egna epicen/storyn tas. Påverkar inte systemet: `socialite` läggs till senare som en serie i shared.

### 7. Ingen global percentil — gruppräkning i stället
- **Meningslös idag:** en grupp om 6 personer ger 0/17/33/50/67/83/100 %.
- **Inte förenlig med Strava-hållningen som den är formulerad:** andelen räknas över användare på data som till stor del är härledd från Strava (höjd, tid, distans, starttid) och visas för användare utanför den grupp datat kommer från.
- **Beslut:** v0.6.0 visar tiernamnet (Common…Legendary) som rarity — fast av tröskeln, inte av populationen — och **gruppräkning** ("hålls av 3 av 6 i din pack", `holders` i `GET /badges/group`): gruppens eget spelläge, inom gruppen. Prototypens "Top X % of users" tas bort ur designen.
- Global/percentilbaserad rarity (LoL-stil) hör hemma efter multi-grupp och kräver då ägarens uttryckliga ja, bedömning mot Strava-villkoren för aggregerad statistik och ett anonymitetsgolv (minst N grupper, minst M användare per serie).

### 8. Scope-snitt för v0.6.0
- **Ingår (8 serier):** Milestoner, Earth Trotter, Climber, Streak Keeper, Early Bird, Night Owl, Speedster, Precisionist — beräknas ur `runs`-kolumner som redan finns, ingen extra trigger, ingen korsanvändarlogik. Plus: `user_badges` + `displayed_badge_series` + migration 035, `computeBadgeTiers`/`diffBadgeTiers` + `evaluateBadges` + backfill-skript, `/api/badges`, profilen (samling + val), Runner card, Board-rader, uppgraderingspopup, `badge_earned` i news.
- **Skjuts (egen epic/story senare):** Weathered Soul (kräver efterhängande-väder-triggern i `backfillMissingWeather`, väder-definitionen och verifiering av hur väderservicen tolkar `start_time`; passar med "vädertitlar" i roadmap-ordningen) och Socialite (beslut 6).
- **Första att stryka om det trängs:** news-raden `badge_earned`. Popupen via `seen_tier` är kärna.

### 9. Strava-hållningen — hur ADR:n följer den
1. **Ingen AI/ML** i regler, texter eller ikonval.
2. **Gruppavgränsning från dag ett:** alla `/api/badges`-endpoints kontrollerar att målanvändaren är i anroparens grupp (404 annars). Titelsystemets globala leaderboard och `GET /titles/user/:userId` kopieras inte (rättas inte här, flaggas).
3. **Ingen statistik över användare utöver spelmekanik:** inga globala aggregat (beslut 7); ingen jämförelse av användares koordinater (beslut 6).
4. **Raderingar slår igenom:** badges räknas om (beslut 2) och news-rader retractas (beslut 5). När Strava-webhooks för raderade aktiviteter byggs ska deras handler gå genom samma väg (radera runda → `calculateUserTotals` → `evaluateBadges`); webhook-ADR:n ska nämna det.
5. **Lagring:** `user_badges` lagrar härledda gamification-fakta (tier, tidpunkt, run-referens), inget Strava-rådata — samma kategori som `user_titles`, som redan lagras; förenligt med "lagring orörd" (Lead-beslut).

### 10. Utrullning
1. Ägargodkänd migration 035 (`apply_migration`; `list_migrations`; `get_advisors security` efteråt — RLS på, anon → 42501 som för 034).
2. `scripts/backfillBadges.ts` (som `backfillActivityLog.ts`): **default dry-run** (tierfördelning per användare och serie, ingen skrivning), `--apply` skriver diffen (nya rader och uppgraderingar) med `seen_tier = tier` och inga news-rader. Valfritt `--series=`. `--silent` (med `--apply`) normaliserar dessutom befintliga rader med `seen_tier < tier` till `seen_tier = tier`, för retuning eller en körning efter deploy. Idempotent. Trösklarna i beslut 3 (v2) är kalibrerade mot dry-run i prod. Efter varje tröskeländring körs dry-run → `--apply --silent`.
3. Deploya backend (kod som skriver kräver att tabellen finns; annars loggas icke-fatala fel), därefter frontend.
4. `changelog.json`: "workingOn → Badges" flyttas till levererat vid release.

### 11. Teststrategi (ADR 001, Produkt-läge)
| Vad | Nivå | Innehåll |
|---|---|---|
| `computeBadgeTiers` per serie | Enhetstest (shared) | Fixtures med gränsvärden under/vid/över tröskel; strikt "<" för Speedster; ej nästlade tiers (högsta uppfyllda); **väggklockan läses oförändrad:** `start_time` `2026-07-01T05:30:00Z` är 05:30 (inte 07:30), samma värde vinter och sommar (ingen DST-konvertering); **en runda utomlands räknas i sin lokala tid** (fixture med `start_time` ur en annan zons väggklocka, t.ex. 06:10 Tokyo-tid lagrad som `…T06:10:00Z`, räknas som 06:10); rundor utan `start_time` räknas inte i Early Bird/Night Owl; fönster över midnatt (Night Owl 23:30–00:30), 04:00-gränsen; 5 km-kvalificering 4,9/10,0; `distance` med 2 decimaler (exakt hel km via heltalsaritmetik, inte flyttal); tomma rundor → alla tier 0, ingen NaN |
| Kontraktstest över serielistan | Enhetstest | unika serienyckel, antal tiers == `MAX_TIER` (6), tiernamnstabellen täcker alla tiers, varje regel pekar på ett registrerat mått, tröskelvärden ändliga |
| `diffBadgeTiers` | Enhetstest | alla kombinationer: ny, uppgradering, nedgradering, radering, oförändrad, `seen_tier`-klämning (`least`), okänd serie i DB ignoreras |
| `evaluateBadges` | Beteendetest mot in-memory-store (porten, beslut 2) | första rundan → insert + `badge_earned`; omkörning → noll skrivningar; uppgradering lämnar `seen_tier`; radering av rundan → nedgradering/radering + retract + serie ur showcase; fel i store sväljs |
| Skrivvägen (zon 1) | Beteendetest i samma PR | `calculateUserTotals` sparar totaler även när `evaluateBadges` kastar; anropas efter totalskrivningen |
| `/api/badges/*` | Route-test (supertest mot `createApp()`) | 401; **annan grupp → 404**; showcase: >3, dubbletter, okänd serie, ej ägd → 400; `seen` idempotent och monotont; ingen `seen_tier` för andras rader; wiring-testet täcker routern |
| Migration 035 | Statiskt test | CHECK-listan för `activity_log.type` == `ACTIVITY_TYPES` (inkl. `badge_earned`). **Befintliga `activityLogMigration.test.ts` läser migration 034 och går sönder när `ACTIVITY_TYPES` utökas** — generaliseras till "senaste migrationen som definierar `activity_log_type_check`" i samma PR |
| Frontend | RTL/Vitest | popup-kö (flera nya tiers, avfärdande → `seen`), showcase-väljarens max-3, låsta serier visar kravtext; news-modellen renderar `badge_earned` (exhaustive switch) |
| Backfill-skript | Enhetstest av byggfunktionerna; dry-run skriver inget | idempotens |
| E2E (Playwright) | Ej nu | Villkorat av icke-prod-miljö (ADR 001) |
`fakeSupabase.ts` är inte byggd; ADR:n är inte beroende av den (porten i beslut 2).

## Alternativ som övervägts
- **Badge-definitioner i en DB-tabell (seed + admin-redigering).** Bortvalt: trösklarna är kod-konstanter, frontend behöver dem vid bygge, och varje justering skulle kräva migration/seed utan att någon admin redigerar dem (YAGNI). Omprövas om admin ska ställa trösklar eller grupper ska ha egna.
- **Ingen `user_badges`-tabell: härleda allt vid läsning** (popup via `user_seen_items`-mönstret, showcase i `users`). Följer ADR 007:s "härleda, inte lagra". Bortvalt: upgrade-detektion för popup/news kräver att man vet "förra tiern" (lagrat tillstånd ändå), Board skulle räkna om alla gruppmedlemmars rundor vid varje sidladdning (skalar dåligt med multi-grupp), och `user_titles` visar att härledda gamification-fakta redan lagras.
- **Permanenta badges (high-water mark).** Bortvalt (beslut 2).
- **Återanvända titelmotorerna direkt** (`titleEngineRegistry`). Bortvalt: rankningsvärden i stället för mått, DB-tröskel, shared kan inte importera backend; delar bara mönstret och väggklocke-semantiken.
- **En rad per (användare, serie, tier).** Bortvalt: kravet är att bara bästa nivån visas; flera rader kräver filter överallt och fler skrivningar per runda. Historiken finns i `badge_earned`-raderna.
- **`display_slot` på `user_badges` i stället för `users.displayed_badge_series`.** Bortvalt: tvåstegsuppdatering utan transaktion vid byte; en `text[]`-uppdatering är atomisk och följer `displayed_title_ids`. Pris: en återkallad serie kan ligga kvar i arrayen tills `evaluateBadges` rensar den (läsvägen skär alltid mot ägda).
- **`badge_earned` i `user_seen_items`/egen notistabell.** Bortvalt: ADR 008 skapade activity_log för detta och reserverade typen.
- **Utvärdera i nattjobb i stället för efter varje skrivning.** Bortvalt: popup/leaderboard skulle släpa upp till ett dygn. Ett nattligt läkjobb kan läggas till om racen i beslut 2 uppträder.
- **Konvertera `start_time` till Stockholm-tid för tidsserierna.** Bortvalt (ägarregel): `start_time` är redan löparens lokala väggklocka; en konvertering förskjuter 1–2 h och är fel för en löpare utomlands.
- **Global percentil nu.** Bortvalt (beslut 7).

## Konsekvenser
- **Ny datalagring — flaggad (hård gräns):** en ny tabell `user_badges`, en ny kolumn `users.displayed_badge_series` och utökad CHECK på `activity_log` i produktionsdatabasen. Migration 035 kräver ägarens uttryckliga godkännande (permissions: ask), körs via MCP `apply_migration`, är additiv (expand; ingen contract). Datan är **härledd** ur rundor och kan raderas/regenereras med backfill-skriptet. **Backfill-skriptet skriver data i prod och kräver likaså godkännande** (dry-run först). Ingen känslig personuppgift tillkommer; ingen anon-åtkomst (RLS på, inga policyer, `revoke` från anon/authenticated).
- **Inga externa tjänster, ingen kostnad** (ingen 15c-flagga). Volym: ≤ 10 rader per användare, något per runda i skrivningar.
- **Skrivrättigheter:** endast backend (service role) skriver `user_badges`, och bara `badgeService` (+ backfill-skriptet). `PUT /badges/showcase` och `POST /badges/seen` skriver bara anroparens egen rad/kolumn. Läsning bara via `/api/badges` med gruppkontroll.
- **Produktionsrisk (zon 1):** `calculateUserTotals` får ytterligare en sidoeffekt (en `select` av rundor + en `select` av `user_badges` + ev. skrivning). Mildras av att anropet är icke-kastande, sker EFTER totalskrivningen och jämför bara skillnader. Latensen på POST/PUT/DELETE `/runs` ökar med en handfull små queries.
- **Positivt:** återkallelse och backfill följer ur samma rena funktion; trösklar kan retuneras utan migration; popup och news kräver inget nytt kanalsystem; inga nya stora filer (zon 10).
- **Negativt/risker:** (1) `earned_at` vid backfill är utrullningstidpunkten, inte den historiska. (2) Streak Keeper vilar på `StreakService`/`users.longest_streak` och ärver zon 4:s dubbelimplementationsrisk. (3) Tidsserierna fungerar bara för Strava-rundor (manuella saknar `start_time`). (4) Manuella rundor kan "mata in" distansserierna (samma exponering som XP). (5) Övre tiers kan vara orealistiska/triviala för en grupp om 6 — mildras av dry-run före `--apply`. (6) Ändrade tier-regler ger vinst/förlust av badges vid nästa utvärdering; retuning följs av `--apply --silent`. (7) En användare kan tappa en badge genom att ändra/radera en runda.
- **Fynd utanför scope:** `GET /titles/user/:userId` saknar gruppkontroll (känt, zon 8). `WeatherService`s tolkning av `start_time` rättad i RUN-106 (se beslut 3, väder-not). Befintliga `activityLogMigration.test.ts` måste generaliseras (beslut 11).
- **Arkitekturdiagram:** uppdateras i SAMMA commit som ADR:n går in och koden byggs — `docs/architecture/runquest-architecture.json` får i Data-kortet (raden om `activity_log`/`GET /api/news`, ~r.47) en rad: "Badges (ADR 009): `user_badges` (en rad per användare × serie = bästa tier) härleds ur rundor av `evaluateBadges`, anropad från `calculateUserTotals`; läses via `GET /api/badges/*` (gruppavgränsat, 404 utanför grupp); `badge_earned` loggas i activity_log; ingen anon-åtkomst". Tabellräknaren i `db`-komponenten ändras av Lead när migration 035 körts. HTML genereras om (archify) av Lead. Under bygget rörs diagrammet inte.
- **STATE.md-ändringar att föreslå:** (1) ADR-index: rad 009 (nedan). (2) Stack/DB: "26 tabeller efter migration 035". (3) Kritiska flöden: nytt flöde 9 "Badges — runda skrivs → `calculateUserTotals` → `evaluateBadges` → `user_badges` → `GET /api/badges/user/:id`; Rök: logga en 5 km-runda → Milestoner tier 1; radera rundan → badgen försvinner; popup visas en gång". (4) Konventioner: "Badge-tiers är härledda och återkallbara (`services/badgeService.ts`, regler i `packages/shared/src/badges.ts`)" **och ny konventionsrad: "`start_time` = löparens lokala väggklocka (Strava `start_date_local`, lagrad med falskt 'Z'); läs med UTC-getters (`utcMinutes`), konvertera aldrig till någon tidszon. Manuella rundor har ingen `start_time`."** (5) Zon 1: `calculateUserTotals` har nu en andra sidoeffekt (badges, best-effort). (6) Ordlista: "badge/serie/tier → `user_badges`, `series`, `tier`". (7) Behörigheter: backfill-skriptet kräver ask. (8) Zon 8-not: badge-endpoints är gruppavgränsade; titel-endpoints är det inte.
- **Jira (inget skrivet):** epic RUN-1 och story RUN-2 finns; fixVersion v0.6.0 oförändrat; inga beroenden på andra epics förutom migration 035 och att profilsidan kan delas med andra v0.6.0-epics (konfliktyta). Weathered Soul och Socialite får egna epics/stories senare.

## Revisit-triggers
- Fler grupper (multi-grupp) → ompröva global percentil (beslut 7) och om trösklar ska vara gruppvisa.
- Trösklar justeras efter dry-run, eller ägaren ändrar något i beslut 3 → ändring i shared + `--apply --silent`, ingen migration.
- Designen vill ha progressbars → läs-tidsberäkning för anroparen eller en `jsonb`-kolumn.
- Strava-webhooks för raderade aktiviteter byggs → bekräfta att de går via `calculateUserTotals`→`evaluateBadges` (beslut 9.4).
- Strava-villkoren/kapacitetsansökan kräver annan hantering av härledd data → ompröva `user_badges` mot läs-tidsberäkning.
- Socialite/Weathered Soul tas → ny serie i shared; Socialite kräver korsanvändar-utvärdering (egen ADR/addendum); Weathered Soul kräver efterhängande-väder-trigger.
- Admin ska ställa trösklar, eller badges ska ge belöning → definitionerna flyttas till DB resp. skrivvägen (XP/tokens, ADR 004/005) öppnas.
- `evaluateBadges` syns i skrivvägens latens, eller racen i beslut 2 uppträder → asynkront/nattligt läkjobb; outbox när notiser byggs (ADR 008 beslut 11.6).
- `start_time` börjar lagras på annat sätt (t.ex. riktig UTC) → tidsserierna och väggklocke-konventionen måste ses över.

---

## Beslutsöversikt (ägarbeslut och Lead-beslut 2026-10-11)

| # | Fråga | Beslut | Av |
|---|---|---|---|
| 1 | Antal nivåer | Sex (Common/Uncommon/Rare/Heroic/Epic/Legendary) | Ägaren |
| 2 | Tid på dygnet | Löparens lokala väggklocka ur `start_time` (UTC-getters), aldrig konvertering; manuella rundor räknas inte i tidsserierna | Ägaren |
| 3 | Global percentil | Nej; tiernamn + gruppräkning | Lead |
| 4 | Belöning vid tier-up | Kosmetiskt; knappen byter text från "Claim Reward" | Lead |
| 5 | Lagra `user_badges` | Ja (som `user_titles`) | Lead |
| 6 | Återkallbara | Ja | Lead |
| 7 | Socialite, Weathered Soul | Skjuts till egna epics/stories | Lead |
| 8 | Trösklar | v2 (ägarbeslut efter dry-run i prod, RUN-135): en mätning per serie, strikt stigande, flerårsstegar; Precisionist bara Strava-rundor | Ägaren |
| – | Migration 035 + backfill `--apply` | Kräver ägarens uttryckliga ja | Ägaren |

## Föreslagen STATE.md-indexrad
```
  009 · Föreslagen · Badgesystem: sex tiers (Common…Legendary), serier definierade i kod (packages/shared/badges.ts, 8 serier i v0.6.0, tier = högsta uppfyllda regel, tid på dygnet = väggklocka ur start_time, aldrig tidszonskonvertering); tabell user_badges (en rad per användare×serie, migration 035, RLS utan policyer) + users.displayed_badge_series (max 3); härledda och ÅTERKALLBARA — evaluateBadges anropas från calculateUserTotals (icke-kastande, ADR 008-mönstret); kosmetiska (ingen XP), popup via seen_tier, news via activity_log-typen badge_earned; /api/badges gruppavgränsat (404 utanför grupp); ingen global percentil (gruppräkning); Socialite + Weathered Soul skjutna; migration 035 kräver ägargodkännande
```

## Addendum 2026-10-11 (Lead): migrationen delad i två

Beslut 1:s migration delades vid förfiningen så att News-delen kan strykas separat (ADR beslut 8):
- **035_create_user_badges** — `user_badges` + `users.displayed_badge_series` (+ CHECK max 3 i ett idempotent do-block i stället för ett nakent `add constraint`). Applicerad i prod 2026-10-11 efter ägarens ja (RUN-113/RUN-114).
- **036** — utökningen av `activity_log_type_check` med `badge_earned` + `ACTIVITY_TYPES` i shared + generaliserat `activityLogMigration.test.ts` (RUN-122). Hänvisningarna till "migration 035" för `badge_earned` ovan (beslut 1 sista blocket, konsekvenser och testplanen) avser alltså 036.
Inget beslut i sak ändras.
