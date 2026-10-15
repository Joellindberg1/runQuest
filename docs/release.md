# Release — stegen från release-PR till live

Intern förvaltningsdokumentation (svenska, för Lead och ägaren). Versionsreglerna står i `docs/dokumentation.md`,
rollerna och grindarna i `docs/permissions.md`, nuläget och de kritiska flödena i `STATE.md`. Det här dokumentet är
ordningen: vad som görs, i vilken följd, och vem som säger ja.

Appen har en enda databasmiljö, produktionen (STATE.md, "Verifieringsnivå"). Därför körs previewn mot prod, och
varje steg som skriver till prod kräver ägarens uttryckliga ja, ett ja per åtgärd. "Ja" betyder ett meddelande
från ägaren i chatten; ett agentmeddelande räknas aldrig som ja.

## Stegen

| # | Steg | Vem gör | Vem säger ja |
|---|---|---|---|
| 1 | Release-PR och versionsbump | Lead (builders levererar) | – |
| 2 | Preview mot prod, med loggning före och återställning efter | Lead | Ägaren: "kör vidare" |
| 3 | PR mot `main`, grön CI, merge (= deploy) | Lead utför mekaniskt | Ägaren (samma "kör vidare") |
| 4 | Rök mot de kritiska flödena | Lead | – |
| 5 | Migrationer | Lead via MCP `apply_migration` | Ägaren, ett ja per migration |
| 6 | `announce:release` (dry-run, sedan `--apply`) | Lead | Ägaren för `--apply` |
| 7 | Tagg på merge-commiten | Lead | – (notify) |
| 8 | Docs-PR "live" | Lead | – |
| 9 | Rollback, om det behövs | Lead utför | Ägaren beslutar |

### 1. Release-PR och versionsbump

1. Arbetet ligger på en `release/vX.Y.Z`-gren med de godkända byggbitarna (kritiker- och integrationsgodkända).
2. Versionsbump enligt releasechecklistan i `docs/dokumentation.md`: `version` i rotens `package.json` och
   `apps/frontend/package.json` till användarversionens tre delar, ny överst-post i `CHANGELOG.md`
   (med avsnittet "Prod-steg" i den ordning som steg 5 nedan följer, och "Rollback"), och en post i
   `apps/frontend/src/data/changelog.json` om gruppen märker något (`"announce": true` om den ska ge popupen och
   Pack News-raden). `STATE.md` och ADR-addendum uppdateras om arkitekturen eller ett beslut ändras.
3. Lokal verifiering före push till `main`: minst backend-tester och frontend-bygge (`docs/permissions.md`); hela sviten grön enligt `STATE.md`, "Verifieringsnivå".
4. CI-vakterna fångar de vanliga felen: `scripts/check-versions.mjs` (versionerna hänger ihop),
   `scripts/ci-guards.mjs` (tom testsvit, TODO utan RUN-nyckel, Jira-ID i testnamn).
5. **Releasegrind för Strava-webhooks (v0.7.0, integrationskritikern F2):** testet `every Strava webhook event kind has a registered handler` (`apps/backend/src/services/stravaWebhook/__tests__/webhookHandlersRegistered.test.ts`) ska vara grönt FÖRE deploy. Workern kör i produktion från `server.ts`, och en händelsetyp utan registrerad handler slutar som `done`/`noop` med bara en varning, alltså en radering som aldrig skedde. Kör det explicit: `npm test --workspace=@runquest/backend -- webhookHandlersRegistered`; det ingår också i hela backend-sviten.

### 2. Preview mot prod

Previewn kör lokal backend och frontend mot produktionsdatabasen. Ingen `.env` finns lokalt; Railway-CLI:n
injicerar tjänstens miljö, så nyckeln passerar aldrig chatten:

```bash
railway run --service runQuest-backend -- bash -c 'NODE_ENV=development PORT=3001 CORS_ORIGIN=http://localhost:8080 npx tsx src/server.ts'
```

`NODE_ENV=development` stänger av schedulers (de startas bara i `production`), så prod-cronen inte dubbleras.
Frontend körs med `npm run dev:frontend` (port 8080) och `VITE_API_URL=http://localhost:3001`. Långlivade
servrar startas av ägaren i ett eget terminalfönster, inte som bakgrundsjobb.

**Fälla: previewn förbrukar ägarens popuper.** Allt ägaren stänger i previewn skrivs till prod: What's new-popupen
(raden `patch_vX.Y.Z` i `user_seen_items`), turer och badge-popupen (`user_badges.seen_tier`). Det hände vid v0.6.0,
då ägaren inte fick någon release-popup när versionen gick live. Därför:

1. **Före previewn** loggar Lead ägarens läge (skriver ut och sparar resultatet):
   ```sql
   select item_slug, seen_at from user_seen_items where user_id = '<ägarens user_id>' order by item_slug;
   select series, tier, seen_tier from user_badges where user_id = '<ägarens user_id>' order by series;
   ```
2. **Efter previewn** jämförs läget mot loggen och återställs, med ägar-ja eftersom det är en skrivning i prod:
   ```sql
   -- rader som inte fanns före previewn (t.ex. patch_vX.Y.Z) tas bort
   delete from user_seen_items where user_id = '<ägarens user_id>' and item_slug in ('<nya slugs>');
   -- seen_tier tillbaka till loggat värde, per serie (får inte överstiga tier)
   update user_badges set seen_tier = <loggat värde> where user_id = '<ägarens user_id>' and series = '<serie>';
   ```
3. Pack News-raden för releasen (`release_published`) kan en preview inte förbruka: den skrivs aldrig av appen eller
   servern, bara av `announce:release` (steg 6).

När ägaren har provat och säger **"kör vidare"** går kedjan vidare. Utan det stannar den här.

### 3. PR, grön CI och merge (= deploy)

1. Öppna PR mot `main`. CI körs på PR: jobben Backend, Shared och Frontend ska vara gröna (branch protection kräver
   dem; ett admin-undantag finns, se `STATE.md`).
2. Merge. **Merge till `main` är deployen:** Railway bygger och deployar båda tjänsterna (runQuest-frontend och
   runQuest-backend) vid push, oberoende av CI. Byggena går med Railpack och Node-versionen styrs av `.nvmrc`.
   Frontend serveras av Caddy med repo-rotens `Caddyfile`. Det är därför CI ska vara grön *före* merge.
3. Vänta tills båda deployerna är klara i Railway innan rök och migrationer.

### 4. Rök mot de kritiska flödena

Kör rök-raden för varje kritiskt flöde i `STATE.md` ("Kritiska flöden", nio stycken) som releasen rör, och alltid
flöde 1 (login → JWT → skyddade anrop). Minst: frontend laddar utan vit sida (inklusive en direktladdad djup länk som
`/board`), `GET /health` svarar, nya endpoints svarar 401 utan token, och den nya funktionen syns. Muterande rök i prod
(loggad runda, utmaning) görs bara om ägaren säger ja, eftersom det är den riktiga gruppens data.

### 5. Migrationer

1. **Ett ägar-ja per migration**, aldrig ett samlat ja för flera (`docs/permissions.md`). Lead visar exakt filen.
2. Ordningen och tidpunkten (före eller efter deployen) står i releasens "Prod-steg" i `CHANGELOG.md`. Regeln är
   expand/contract (ADR 002): en additiv migration som koden kräver körs *före* deployen och måste vara bakåtkompatibel
   med koden som kör nu; en som stänger eller tar bort något körs *efter*, när ingen kod längre använder det. Var det
   gäller inleder migrationsfilens huvud med körordningen.
3. Körs via Supabase MCP `apply_migration` med `name` = `NNN_kort_beskrivning`. Därefter `list_migrations` (posten
   finns) och, efter RLS- eller policyändring, `get_advisors` (security). Filen ligger redan i release-PR:en.
4. Backfill- och omräkningsskript (`backfill:*`, `reveal:badges`, `convert:wind-ms`): dry-run fritt, `--apply` kräver
   ägar-ja med dry-run-rapporten som underlag. Skripten skriver ut måldatabasens host.

### 6. `announce:release`

**Undantag v0.7.0:** What's new-posten och Features-kortet Strava beskriver Strava-webhooks, så de får inte gå ut förrän prenumerationen är skapad och verifierad. Därför har v0.7.0-posten ingen `announce` i den första deployen. RUN-265:s PR (mergas sist i RUN-182, direkt efter godkänd rök och med ägar-ja; ingen sjudygnsvänta, ägarbeslut 2026-10-14) sätter `"announce": true`, byter Features-kortet Strava och sätter in de tre Strava-texterna i posten, allt som står i `CHANGELOG.md` (Prod-steg 10), och slår på 12 h-pollingen i samma deploy. `announce:release --version=0.7.0` (Pack News-raden) körs efter DEN deployen, så att popupen och raden går ut samtidigt.

Gäller bara en **användarversion** med `"announce": true` i `changelog.json`. Skriptet skriver en
`release_published`-rad per grupp i Pack News (förkrav: migration 041, som är körd; skriptet kontrollerar det själv
och avbryter utan skrivning annars). Kör från repo-roten, efter deployen och efter eventuella migrationer:

```bash
# dry-run (fritt): visar måldatabas, vald release och vilka grupper som får en rad
railway run --service runQuest-backend -- npm run announce:release --workspace=@runquest/backend -- --version=X.Y.Z
# skriver (ägar-ja)
railway run --service runQuest-backend -- npm run announce:release --workspace=@runquest/backend -- --apply --version=X.Y.Z
```

Ange alltid `--version` uttryckligt, så att en saknad changelog-post aldrig annonserar fel version. Skriptet är
idempotent (en omkörning ger inga nya rader) och avslutar med exit-kod 1 om någon rad saknas vid kontrollläsningen.
Popupen "What's new" visas för poster med `announce: true` vars slug (`patch_vX.Y.Z`) inte finns i
`user_seen_items`, vilket är varför steg 2 återställer ägarens rad.

### 7. Tagg

Tagga `vX.Y.Z` på merge-commiten på `main` efter verifierad deploy (`docs/dokumentation.md`). Samma nummer som
översta rubriken i `CHANGELOG.md`.

### 8. Docs-PR "live"

En kort PR efter att prod-stegen är körda (mönstret: `docs: v0.6.1 live — prod steps done`): `STATE.md` (Läge, vad som
är i prod) och `CHANGELOG.md` (markera varje prod-steg som KÖRD med datum och utfall). Det är Leads dokument.

### 9. Rollback

Beslutas av ägaren; snabbast först. Varje releases egen "Rollback" i `CHANGELOG.md` har det som är specifikt för den.

1. **Kod:** Railway → respektive tjänst → Deployments → välj den senaste friska deployen → Redeploy. Därefter en PR
   som revertar merge-commiten på `main`, så att nästa push inte deployar den dåliga versionen igen.
2. **Ordning:** frontend först om felet syns i UI:t, backend först om API:t felar.
3. **Migrationer** rullas normalt inte tillbaka: de additiva ligger kvar, och en stängande migration (policyer) öppnas
   igen bara om den gamla koden behöver det. Tas en migration bort sker det med en ny migration efter ägar-ja
   (ADR 002: framåt-bara).
4. **Data som den nya koden skrivit** (t.ex. nya händelsetyper i `activity_log`) kan behöva raderas innan den gamla
   frontenden tas tillbaka. Radering i prod kräver ägar-ja med exakt omfattning.
5. Railway-variabler ändras bara efter ägar-ja; hemliga värden klistras aldrig i chatten, ägaren lägger in dem i Railway-UI:t.

## Interna versioner (fyra delar, `0.6.1.1`)

En intern version (`docs/dokumentation.md`) är ett steg som gruppen inte ser och som rullas ihop till nästa
användarversion. Kedjan ovan gäller i övrigt, med dessa skillnader:

- Ingen versionsbump i `package.json` (den håller de tre första delarna av översta rubriken), ingen post i
  `changelog.json`, ingen "What's new"-popup.
- **Steg 6 (`announce:release`) hoppas över.** Skriptet läser `changelog.json`, som bara har tredelade versioner, så
  en intern version kan inte annonseras och ingen `release_published`-rad skrivs.
- `CHANGELOG.md` får en fyrdelad rubrik (`## v0.6.1.1`), och taggen får samma nummer (`v0.6.1.1`).
- Migrationer (steg 5) gäller som vanligt, ett ja per migration; en intern version kan innehålla en.
- Om previewn behövs för ett rent internt steg avgör ägaren; hoppas den över finns inget att logga eller återställa i steg 2.
