# Changelog Feature — `/features` (Feature & Version) + "What's new"-popupen

Det gruppen ser om appens utveckling, ur EN källa: `src/data/changelog.json` (docs/dokumentation.md). Sidan `/features` visar den med tre flikar
(Features · Working on · Releases, `?view=`); popupen "What's new" (`features/onboarding/components/PatchNotesModal`) visar poster med `"announce": true`
en gång per användare. Versionsnumret och datumet överst är den senaste postens — inget är hårdkodat. Mobil är härledd ur Web Prototypens skärm
(prototypen saknar mobilvy): samma kort i en kolumn, release- och ändringsraderna bryter om via tokens. `pages/FeaturesPage.tsx` är tunn.

## Struktur

- **changelog.json** `{ features, workingOn, releases }` — `features` = korten under Features, `workingOn` = korten under Working on, `releases` = nyaste först.
  Posten: `{ version, type, date, title, announce?, changes: [{ type: feature|improvement|bugfix, description }] }`. Typen följer versionsnumret
  (x.0.0 major · x.y.0 minor · annars patch), datumet skrivs "5 October 2026". Enkel engelska, vad användaren märker.
- **changelogTypes.ts** — TS-schemat. **changelogData.ts** — det enda stället som läser JSON-filen.
- **changelogModel.ts** — ren logik: flikarna, versionsraden, öppen/stängd release, `announcedNotes` (posterna med `announce`, slug `patch_v<version>`).
- **components/** — `ChangelogScreen` (flikar + vilken release som är öppen), `FeatureCards`, `WorkingOnCards`, `ReleaseList`.
- `changelog.css` — sidans stilfil; mått (`--rq-changelog-*`, `--rq-whatsnew-w`) i temafilen, sektion 1.29 (index.css + docs/design/temafil-forslag.css).
  Popupens css ligger i `features/onboarding/whatsNew.css`.

## Regler värda att komma ihåg

- **En källa, tre läsare:** sidan, popupen och onboarding-kön (`useOnboardingQueue`, `OnboardingOrchestrator`) läser alla `changelog.json` via `changelogData`.
  Ett guard-test låser att ingen annan fil importerar JSON-filen och att `patchNotes.ts`/`changelogHelpers.ts` inte kommer tillbaka.
- **`announce` = popup.** Slugen (`patch_v2.0.0`) sparas som "sett" i onboarding-tabellen när användaren trycker Got it/✕/Escape. Ändra aldrig slugen för en redan släppt
  version (alla skulle få popupen igen); en omskriven post som alla ska se igen får en ny version. Kön visar annonserade poster nyaste först, en i taget, efter första-inloggningstouren.
- **Versionsvakten** (`scripts/check-versions.mjs`, CI-steget "Version guard") fäller bygget om ordningen, semver, datumformatet, typen, `announce` utan ändringar eller
  rubrikerna i CHANGELOG.md inte stämmer. Poster äldre än CHANGELOG.md:s äldsta rubrik (v0.x) finns bara i changelog.json och kräver ingen rubrik.
- **Ikonnamn** i `features`/`workingOn` måste finnas i `RQIcon` — ett test kontrollerar det (okänt namn faller annars tyst tillbaka på pokalen).
- **Färg:** Features = grön kant (lever), Working on = guld-kant (temafilens `--rq-card-edge-soft`-roll, prototypens val), release-kantens styrka följer typen (major guld).
  Ändringstyp: feature grön · improvement neutral · bugfix röd (`data-kind` → `--rq-kind`). Inga knappar på sidan utom flikarna och release-rubrikerna; popupen har EN guldknapp.
- **Rörelse:** sidan glider in med den delade `.rq-rise` vid flikbyte; popupen står still.
- Öppna antaganden: `docs/open-assumptions.md` → "Feature & Version + What's new (inkrement 11A)".
