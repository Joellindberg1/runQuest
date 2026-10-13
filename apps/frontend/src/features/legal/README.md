# Legal — `/legal`

Integritetstext och villkor på en publik sida, ett dokument ("Privacy & Terms") med ankarna `#privacy` och `#terms`
(`LEGAL_PRIVACY_ID`, `LEGAL_TERMS_ID` i `paths.ts`). Länkas från landningens footer, väntelistans samtyckesrad och senare Strava-samtycket.
`pages/LegalPage.tsx` är tunn och laddas lazy (`routes.tsx`, utanför `RequireAuth`, bredvid preview-routerna).

## Struktur

- **components/LegalScreen** — sidan: `header` (länk "Back to RunQuest"), `main` (h1, `section#privacy`, `section#terms`), `footer` (kontaktadress).
  Varje avsnitt är en `article` med h3 (`id="legal-{id}"`) och ett `<p>` per stycke.
- **hooks/usePageMetadata** — titel, description och canonical medan sidan är monterad; återställs vid avmontering (rör inte element som saknas).
- **hooks/useScrollToHash** — scrollar till `#privacy`/`#terms` (eller valfritt id) efter rendering; utan animation vid reducerad rörelse.
- **legalModel.ts** — sidans metadata, rubrik-id:n och `splitOnEmail` (kontaktadressen i en text blir en `mailto:`-länk).
- **Bakgrunden.** `LegalScreen` monterar den delade `TrackBackdrop` (`shared/components`, fast rutnät + bana med tre löpare, som bakom skalets sidor) först i `.rq-legal`, och `.rq-legal__inner` är `position: relative` så att texten ritas ovanpå. Se `trackBackdrop.guards.test.ts`.
- `legal.css` — enda stilfilen. Bara befintliga tokens: kolumnen är `--rq-shell-narrow-max`, sidmarginalen `--rq-landing-pad`.

## Regler värda att komma ihåg

- **Texten bor inte här.** Sidan renderar `getDataPolicy()` och `getTerms()` ur `@runquest/shared` (`packages/shared/src/legal/`) och skriver ingen text själv.
  Personuppgiftsansvarig, kontaktadress och versionen kommer ur samma källa. Importera från `@runquest/shared`, aldrig från en subpath.
- **Inga anrop, ingen auth.** Sidan är publik: ingen backend, ingen react-query, ingen `useAuth`. `LegalScreen.test.tsx` renderar utan providers och bevakar `fetch`.
- **Metadata.** `index.html` har startsidans canonical för alla SPA-adresser. `/legal` står i sitemapen, så sidan sätter sin egen title, description och canonical
  (`https://www.runquest.dev/legal`) vid montering.
- **robots.txt och sitemap.xml** ligger i `public/` och serveras som de är. Sitemapen listar de publika sidorna (`/` och `/legal`); `src/test/seoFiles.test.tsx`
  härleder dem ur `routes.tsx` (routerna utanför `RequireAuth`, utom `/login`, `/preview*` och redirecten) och fäller om sitemapen avviker.
  Varje `User-agent`-grupp i robots.txt har `Disallow: /preview`, eftersom en crawler bara följer sin egen grupp.
