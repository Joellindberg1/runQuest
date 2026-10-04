# 002. Migrationshantering och baslinjeschema

## Status
Godkänd av ägaren 2026-10-04 (Fas 2-paketet)

## Kontext
Schemat lever i produktionsdatabasen (Supabase-projekt
`yrrqaxdngayakcivfrck`), inte i repot (STATE.md zon 7, audit-underlag):

- `apps/backend/migrations/` innehåller 31 numrerade SQL-filer (001–031) med
  luckor och dubbletter: dubbla `005_*` (`add_indexes`,
  `create_challenge_system`) och `010_*` (`add_extended_run_data`,
  `add_pace_std_dev_to_runs`); 003 och 004 saknas.
- Kärntabellerna (`users`, `runs`, `titles`, `user_titles`, `groups`,
  `strava_tokens`, `admin_settings`, `level_requirements`,
  `streak_multipliers`) har ingen `CREATE TABLE` i repot. Migrationerna är
  därför ändringar på ett schema som inte går att återskapa; en tom databas
  kan inte byggas ur repot. `002_admin_setup.sql` hårdkodar dessutom admin-
  namnet. Frontendens `integrations/supabase/types.ts` är föråldrad.
- Körning var manuell (SQL-editor/MCP) utan ledger. Sedan 2026-10-04 körs
  migrationer via Supabase MCP:s `apply_migration`, som loggar i
  `supabase_migrations.schema_migrations`, efter uttryckligt ägargodkännande
  per migration (`docs/permissions.md`: migration mot prod = ask; fil
  committas i samma veva). 030 och 031 (anon-policyer) är de första som
  hanterats så.
- Enda DB-miljön är prod. Ett öppet vägval om staging-/preview-databas
  (STATE-proposal, ägarens beslut) är obeslutat och **låses inte av denna
  ADR**. Denna ADR gör det genomförbart: en staging- eller lokal databas kan
  inte byggas utan en baslinje.
- Befintliga ADR:er: ingen berör migrationer (001 är teststrategi och
  refererar hit för riktig-DB-testnivån).

## Beslut

1. **Genererad baslinje `apps/backend/migrations/000_baseline.sql`** som
   återskapar produktionens FAKTISKA schema per 2026-10-04 efter migration 031:
   - Innehåll: extensions som används, tabeller (kolumner, typer, defaults,
     constraints inkl. unika/främmande nycklar), index, vyer (inkl.
     `title_leaderboard_view`), funktioner/RPC (`increment_event_xp`,
     `update_all_title_leaderboards`, `handle_new_user` m.fl.), triggers,
     `ENABLE ROW LEVEL SECURITY` + alla kvarvarande policyer, Storage-bucket
     `profile-pictures` med dess policyer. Referensdata som appen kräver för att
     fungera (t.ex. `level_requirements`, `streak_multipliers`, `titles`,
     `event_templates`, `event_pools`, utmaningskonfig) tas med som INSERT.
   - **Exkluderas, aldrig i repot:** användardata, `strava_tokens`, allt som
     innehåller hemligheter. `admin_settings`-raden seedas med
     konfigurationsvärden men UTAN `admin_password_hash` (placeholder/NULL) —
     hashen får aldrig hamna i git.
   - Header i filen anger: genereringsdatum, att den speglar prod efter 031,
     hur den genererades och hur den verifierades.
   - Genereras av Lead (som har DB-åtkomst) via katalogfrågor
     (`information_schema`/`pg_catalog`) genom MCP, eller via
     `supabase db dump` om Docker/DB-lösenord ordnats; metoden är Leads val.
     Resultatet verifieras mot prod med ett **schema-fingeravtryck**
     (kolumner/typer/nullbarhet/defaults, index, constraints, policyer,
     funktioner, triggers) som körs mot prod och mot en scratch-databas där
     baslinjen applicerats; utdata ska vara identiskt. Scratch-miljöns art
     (lokal `supabase start` eller tillfälligt projekt) hänger ihop med
     staging-beslutet och ska inte skapa kostnad utan ägarens godkännande.
   - Som biprodukt regenereras frontendens `integrations/supabase/types.ts`
     (Supabase MCP `generate_typescript_types`) så att de föråldrade typerna
     (STATE zon 7) rättas.

2. **Befintliga filer 001–031 fryses som historik.** De får inte ändras,
   renumreras eller raderas, och de ska INTE appliceras på en databas som
   byggts ur baslinjen (baslinjen innehåller redan deras effekt).
   En `apps/backend/migrations/README.md` (skrivs av Builder) förklarar
   regeln: **ny databas = `000_baseline.sql` + migrationer med nummer ≥ 032.**
   Dubbletter och luckor lämnas orörda och dokumenteras i README:n.

3. **Nya migrationer:**
   - Nummer = nästa lediga över både repo och ledger (nästa efter 031 är 032).
   - En fil per logisk ändring, `NNN_kort_beskrivning.sql`, framåt-bara (ingen
     down-fil; ångra = ny migration). Header: syfte, datum, ägargodkännande.
     Idempotent där det är billigt (`if not exists`/`drop ... if exists`).
   - **Körs via Supabase MCP `apply_migration`** med `name` =
     `NNN_kort_beskrivning` så att repo-numret syns i ledgerns namnfält
     (ledgerns `version` är Supabase-genererad tidsstämpel). DDL och
     migrationsdata går via `apply_migration`, aldrig via `execute_sql`.
   - Process: fil skrivs -> ägaren godkänner exakt den filen (permissions.md)
     -> `apply_migration` -> verifiering (`list_migrations` visar den,
     `get_advisors` security efter RLS-/policyändring) -> filen committas i
     samma veva som koden som beror på den.
   - **Expand/contract mot prod utan staging:** migrationen körs FÖRE deploy av
     kod som kräver den och måste vara bakåtkompatibel med den kod som kör nu
     (additiv först; `drop`/`rename` först i en senare migration när ingen
     kod längre använder det). Detta ersätter det skyddsnät staging annars
     skulle ge.
   - Ny tabell: `ENABLE ROW LEVEL SECURITY` i samma migration och inga anon-
     policyer (anon läser bara `level_requirements`, `docs/permissions.md`).

4. **Ingen schemaändring utanför flödet** (SQL-editor, ad hoc `execute_sql`
   med DDL). Drift upptäcks vid varje release av att Lead jämför
   `list_migrations` mot repots filer ≥ 032 (tom diff = ok).

5. **Staging förblir ett öppet vägval.** Baslinjen är förutsättningen, inte
   beslutet: med `000_baseline.sql` + ≥ 032 går en preview-/staging-/lokal-
   databas att bygga oavsett vilket alternativ ägaren väljer.

## Alternativ som övervägts
- **Supabase CLI som primärt flöde (`supabase db pull` / `db push` /
  `migration new`).** Standardverktyget; ger lokal stack (`supabase start`),
  `db reset` ur migrationer och `db diff`. Bortvalt som primärt flöde nu:
  (a) `db pull`/`db push` kräver DB-lösenord och projektlänkning — en
  hemlighet som permissions.md vill hålla borta från agenter, medan MCP-flödet
  redan är PAT-låst till projektet och ask-grindat; (b) `db pull`/`dump`
  använder Docker (shadow-databas/pg_dump) på Windows — extra friktion för en
  ensam ägare (att verifiera); (c) CLI:ns konvention (`supabase/migrations/`
  med tidsstämpelnamn) skulle tvinga fram ännu en omstrukturering av en
  katalog vi just fryser. Ledgertabellen är densamma i båda flödena och
  filerna är ren SQL, så ett senare byte är billigt; CLI kan också användas
  engångsvis för att generera baslinjen (beslut 1).
- **Renumrera/slå ihop historiken till en ren kedja** — bortvalt: omskriver
  historik som redan körts i prod, skapar risk att filer och verkligt schema
  glider isär, och ger ingenting utöver baslinjen.
- **Flytta 001–031 till `migrations/history/`** — övervägt, inte valt: gör
  "applicera allt i rotkatalogen" säkert men ändrar sökvägar i en frusen
  mapp och i historiska referenser. README + header i baslinjen räcker så
  länge ingen verktygskedja globbar katalogen. Omprövas om en sådan införs.
- **Fortsätta utan baslinje (nuläget)** — bortvalt: schemat är då
  oåterskapbart, staging omöjligt, och en förlorad/korrupt prod-databas kan
  inte byggas om ur repot.
- **Alla framtida migrationer som SQL-editor-körningar** — bortvalt: ingen
  ledger, ingen spårbarhet, bryter permissions.md-flödet.

## Konsekvenser
- **Inga nya externa tjänster och ingen kostnad.** Skapar ingen databas;
  verifieringen kräver en scratch-miljö vars art/kostnad avgörs tillsammans
  med staging-beslutet (kostnadsdrivande val flaggas då som avvikelse 15c).
  Baslinjegenereringen är läsning mot prod (MCP, Database: read) — ingen
  skrivning.
- **Känslig data (flagga):** baslinjen får inte innehålla
  `admin_password_hash`, tokens, användarrader eller andra hemligheter.
  Lead granskar filen (sökning på `hash`, `token`, `secret`, e-postmönster)
  före commit. Policyuppsättningen i filen exponerar RLS-modellen i git —
  den är redan publik via frontend-nyckeln, så ingen ny exponering.
- **Positivt:** schemat blir återskapbart och diffbart; staging/lokal DB och
  riktig-DB-tester (ADR 001) blir möjliga; ledgern ger spårbarhet; expand/
  contract-regeln minskar prod-risk utan staging.
- **Negativt/risker:** (1) Baslinjen är genererad, inte handskriven — en miss i
  genereringen (t.ex. glömd policy/trigger) ger en databas som avviker från
  prod; fingeravtrycksverifieringen är därför obligatorisk. (2) Historiken
  001–031 är orörd och därmed fortsatt rörig; README måste hållas läsbar. (3)
  Ledgern innehåller bara migrationer körda via MCP — äldre körningar syns
  inte i den; baslinjen är därför "tid noll". (4) Baslinjen blir daterad för
  varje ny migration; den regenereras inte, nyare ändringar ligger i
  ≥ 032-filerna.
- **Arkitekturdiagram:** ingen ändring (inga runtime-komponenter ändras).
- **STATE.md-ändringar att föreslå:** konventionsraden "DB-ändringar"
  ersätts av regeln i beslut 2–4 (baslinje + ≥ 032 + MCP + expand/contract);
  Stack-raden för Databas nämner baslinjen när den finns; zon 7 uppdateras
  när baslinjen är verifierad.

## Revisit-triggers
- Ägaren väljer staging-alternativ som kräver Supabase CLI/Branching ->
  ompröva CLI som primärt flöde (och katalogstruktur `supabase/migrations/`).
- Fler än en person/agentkedja kör migrationer samtidigt, eller ledger och repo
  driver isär -> automatisera drift-kontrollen i CI.
- Någon verktygskedja börjar globba `migrations/` -> flytta historiken till
  `history/`.
- Schemat har ändrats så mycket (> ~15 migrationer efter 032) att
  baslinje + kedja blir långsam att bygga -> generera ny baslinje (ny ADR).
