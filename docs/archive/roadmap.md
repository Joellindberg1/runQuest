# RunQuest — Roadmap (triagerad)

Triagerad av lead-orchestrator 2026-10-04 ur Notion-roadmapen (2026-04-30),
idébanken "Idéer RunQuest" (2026-09-30) och auditens fynd (STATE.md).
Klassning enligt triage-reglerna: **stor** påverkar kärnbeslut (ägarbeslut +
architect/councils), **medel** kräver arkitekturändring (architect i
growth-läge), **liten** är visuell/additiv (kan rulla direkt), **bugg** går
via buggprotokollet (GitHub Issues är bugghistoriken).

Monetiseringsstrategin hålls medvetet utanför detta publika repo (bor i Notion).

## Förutsättningar före nästa stora feature-våg

1. **Produkt-passets rester:** Sentry (error tracking) + staging-beslutet
   (öppet vägval — baslinjen 000_baseline.sql finns nu, så alternativ 1 är
   verkställbart)
2. **XP-integritetsbuggarna** (issues nedan, B1–B5): gamification bygger på
   att poängen går att lita på — de fixas före badges/seasons

## Buggar (→ GitHub Issues, buggprotokollet)

- B1 Radera sista rundan: streak blir stale och event_xp nollas felaktigt
- B2 users-totaler har TVÅ skribenter med olika formel (DB-trigger utan
  event_xp vs appens calculateUserTotals)
- B3 Strava `GET /status`: dubbelt `res.json` efter expired-grenen
- B4 Schedulers: ej idempotenta (dubbel-XP-risk vid överlapp) + cron i UTC
  medan kommentarer säger Stockholm (1 h fel på vintern)
- B5 Streak: två oberoende implementationer; `current_streak` kan vara inaktuell
- B6 `PUT /runs/:id` saknar POST:ens datum-/distansvalidering
- B7 Strava: refresh-token roteras före DB-skrivning (kan tappa token);
  `external_id`-dedupe saknar unik constraint i DB
- B8 Titlar återkallas aldrig när värdet sjunker under kravet
- B9 Ingen rate limiting på login
- B10 StravaCallbackPage är död kod (tas bort); admin-UI:t visar tomt
  `total_runs` (backend selectar inte kolumnen)

## Stor (ägarbeslut → idea-sparring/council → architect)

| Feature | Källa | Kommentar |
|---|---|---|
| **Badge-system** (rarity-nivåer, mastery-display, profil-slots) | v0.5.0 + idébank (detaljspecad) | Nästa roadmap-milstolpe; nytt schema + UI; spec:en i idébanken är nästan council-färdig |
| **Notifikationer + realtid** (websockets, notifikationscenter) | v0.5.0 + idébank | Infrastrukturval (Supabase Realtime vs egen WS); TopBar-knappen är redan placeholder |
| **Seasons** (säsongslevlar, troféskåp, reset-regler) | v0.5.0 + idébank | Påverkar level-/titel-/XP-modellen i grunden; öppen fråga: season- vs overall-level |
| **Multi-grupp-stöd** (flera grupper per konto, gruppbyte) | Idébank "Core features" | Tenancy-modellen ändras; group_id ligger i dag i JWT (zon 8) |
| **MMR-system för utmaningar** | Idébank (räkneexempel finns) | Ändrar challenge-belöningarna; bygger på befintligt tier-system |
| **Fler datakällor** (Google/Apple/Garmin) | Idébank | Kräver dedupe-samlingspunkt över källor; vilar tills Strava-flödet är buggfritt |
| **Mobilapp (React Native)** | Roadmap v0.6.0 | Efter beta-stabilisering |

## Medel (architect i growth-läge, ADR per ärende)

- **Nya titlar-paketet** — 20 specade titlar (The Batman, The Phoenix, The
  Sniper, The Mountain Goat …). Motor-ramverket finns; kräver att `start_time`,
  väder- och höjddata kopplas in i fler motorer + titel-återkallelse (B8) löses
  först. Kan levereras i omgångar
- **Statssida** (separerad från profil; perioder, trender, GitHub-style
  aktivitetskarta, placeringsgraf)
- **News-/händelseflöde** ("hänt i gruppen" vid leaderboarden; ersätter delar
  av notifikationsbehovet)
- **Bugreport/support via mail** (taggade mail till ägaren; sidebar-knappen är
  redan placeholder) — extern mailtjänst = kostnadsflagga 15c vid val
- **Kalender/träffar** (boka grupprundor, bonuspoäng för deltagande)
- **Interaktiv startsida/login-showcase** (del av nya designen?)

## Liten (kan rulla direkt efter design-ok)

- FAQ-sida (sidebar-knappen finns, disabled)
- Group run history: tydligare poängfördelning + mer stats
- Trender-widgets (XP-snitt 14d finns — bygga vidare: vecko-/månads-km, "jagar/jagad")
- Fler tab-switchar på profil (stats/titlar/historik)

## Redan klart (ur idébanken/roadmapen, levererat tidigare)

Challenges 1v1 med tiers/tokens/boosts (v0.3.0) · events/vecko-utmaningar ·
onboarding-tour + patch notes (v0.4.1) · publika profiler (v0.4.2) · dark mode ·
väder-API · prispall · titel-display-val · playbook/rules-sida · versionsvisning
