// Designspråkets CSS-regler som lint (RUN-223). Tidigare vaktades de av regex mot CSS-text i guards.test.ts per feature
// (src/test/designGuards.ts och elva inklistrade kopior). Som lint fäller de vid skrivandet, med fil och rad.
//
// Reglerna gäller varje feature-CSS. src/index.css är temafilen där tokens (med px, hex och rgb-tripletter) får deklareras; där gäller bara
// förbudet mot kända rester, och src/test/themeTokens.sync.test.ts prövar den (index.css mot docs/design/temafil-forslag.css, och att varje
// token används).
//
// Stylelint ersätter en regels hela inställning när ett overrides-block sätter samma regel. Därför bygger `designRules()` alltid hela
// uppsättningen ur en liten beskrivning av vad filen får göra, och varje fil träffas av exakt ett block.

/** Värde för `animations` och `zIndex` som betyder "inte begränsat i den här filen". */
const ANY = "any";

/**
 * @param {object} [allowed] Vad den här CSS-filen får göra utöver grundreglerna.
 * @param {string[]} [allowed.locals] Egna custom properties (utan --; regex-fragment tillåts). Utelämnad = filen deklarerar inga.
 * @param {string[]|"any"} [allowed.animations] Tillåtna `animation:`-värden (regex); "any" = valfria. Utelämnad = ingen animation.
 * @param {string[]|"any"} [allowed.zIndex] Tillåtna `z-index`-värden; "any" = valfria. Utelämnad = inget z-index.
 * @param {boolean} [allowed.zeroRadius] `border-radius: 0` (skarpa hörn) är tillåtet. Default true.
 * @param {boolean} [allowed.rawLineHeight] Enhetslösa line-height-värden är tillåtna (skalet, äldre än tokenen). Default false.
 * @param {string[]} [allowed.bannedProperties] Egenskaper som dessutom är förbjudna i just den här filen (regex).
 * @param {string[]} [allowed.bannedValues] Värdemönster som dessutom är förbjudna i just den här filen (alla egenskaper).
 * @param {string[]} [allowed.bannedSelectors] Selektormönster som dessutom är förbjudna i just den här filen.
 * @param {Record<string, unknown>} [allowed.extraRules] Ytterligare Stylelint-regler för just den här filen.
 */
function designRules({
  locals = [],
  animations,
  zIndex,
  zeroRadius = true,
  rawLineHeight = false,
  bannedProperties = [],
  bannedValues = [],
  bannedSelectors = [],
  extraRules = {},
} = {}) {
  const allowedValues = {
    // Egna custom properties: bara de filen uttryckligen får deklarera (kortets kant- och tonvariabler m.fl.). Regex-nyckeln träffar
    // deklarationen av varje annan custom property, och inget värdemönster godkänner den.
    [locals.length ? `/^--(?!(?:${locals.join("|")})$)/` : "/^--/"]: ["/(?!)/"],
    // Hörn: skarpa (0) eller radie-token (regel 2).
    "/^border-radius$/": zeroRadius ? ["0", "/^var\\(--rq-radius/"] : ["/^var\\(--rq-radius/"],
    // Typografi ur tokens (regel 1).
    "/^font-family$/": ["/^var\\(--rq-font-/"],
  };
  if (!rawLineHeight) allowedValues["/^line-height$/"] = ["/^var\\(--rq-lh-/"];
  if (Array.isArray(animations)) allowedValues["/^animation$/"] = animations;
  if (Array.isArray(zIndex)) allowedValues["/^z-index$/"] = zIndex;

  const disallowedProperties = ["/^(-webkit-)?transition/", ...bannedProperties];
  if (animations === undefined) disallowedProperties.push("/^(-webkit-)?animation/");
  if (zIndex === undefined) disallowedProperties.push("z-index");

  return {
    // Regel 1: inga råvärden. rgb(var(--rq-…-rgb) / alfa) är det sanktionerade alfa-receptet, så bara bokstavliga rgb()/rgba() fälls.
    "color-no-hex": [true, { message: "Hex-färger hör hemma i temafilen (index.css); använd en token (regel 1)." }],
    "unit-disallowed-list": [["px"], { ignoreMediaFeatureNames: { px: ["/.*/"] }, message: "px-mått hör hemma i temafilen (index.css); använd en token (regel 1)." }],
    "declaration-property-value-disallowed-list": [
      { "/.*/": ["/rgba\\(/", "/rgb\\(\\s*\\d/", ...LEGACY_VALUES, ...bannedValues] },
      { message: "Förbjudet värde: bokstavlig rgb()/rgba() (färger kommer ur tokens, alfa via rgb(var(--rq-…-rgb) / alfa)) eller ett filspecifikt förbud." },
    ],
    "declaration-property-value-allowed-list": [
      allowedValues,
      { message: "Otillåtet värde eller custom property: hörn är 0 eller var(--rq-radius*), line-height var(--rq-lh-*), font-family var(--rq-font-*), animation och z-index bara de dokumenterade, egna custom properties bara de listade." },
    ],
    "property-disallowed-list": [disallowedProperties, { message: "Egenskapen är förbjuden i den här CSS-filen (regel 8 rörelse, lager eller filspecifik regel i designspråket)." }],
    "selector-disallowed-list": [["/:root/", ...bannedSelectors], { message: "Förbjuden selektor: inga egna :root-definitioner i feature-CSS (tokens bor i index.css), eller en borttagen klass." }],
    ...extraRules,
  };
}

// Kända trasiga rester som inte får komma tillbaka: shadcn-sidebarens hsl(var(--sidebar)), var(--rq-foreground) och Silkscreen-typsnittet.
const LEGACY_VALUES = ["/hsl\\(var\\(--sidebar\\)\\)/", "/var\\(--rq-foreground\\)/", "/silkscreen/i"];

const keyframesBanned = { "at-rule-disallowed-list": [["keyframes"], { message: "Ingen rörelse i den här featuren (regel 8): inga @keyframes." }] };

/** @type {import("stylelint").Config} */
export default {
  ignoreFiles: ["dist/**"],
  // Grundregler för alla feature-CSS som inte har ett eget block nedan: ingen rörelse, inget z-index, inga egna custom properties.
  rules: designRules(),
  overrides: [
    {
      // Temafilen får deklarera mått, hex och rgb-tripletter (det är där tokens bor), men inte de kända trasiga resterna.
      files: ["src/index.css"],
      rules: {
        ...Object.fromEntries(Object.keys(designRules()).map((rule) => [rule, null])),
        "declaration-property-value-disallowed-list": [{ "/.*/": LEGACY_VALUES }, { message: "Kända trasiga rester får inte komma tillbaka (hsl(var(--sidebar)), var(--rq-foreground), Silkscreen)." }],
      },
    },
    { files: ["src/features/admin/admin.css", "src/features/settings/settings.css"], rules: designRules({ locals: ["rq-edge", "rq-edge-line", "rq-form-gap"] }) },
    { files: ["src/shared/components/form/form.css"], rules: designRules({ locals: ["rq-form-gap"] }) },
    // Titles och Runner card hade ingen vakt för line-height/rörelse; deras enhetslösa radhöjder (.9, 1.15) och Runner cards ensamma knopp-animation
    // är kända luckor som inte ändras här (CSS-ändring = visuell ändring), men de får inte växa.
    { files: ["src/features/titles/titles.css"], rules: designRules({ locals: ["rq-edge"], rawLineHeight: true }) },
    {
      files: ["src/features/runner/runner.css"],
      rules: designRules({
        animations: ["/^rqRunnerKnob var\\(--rq-dur-bar\\) var\\(--rq-ease-bar\\) both$/"],
        rawLineHeight: true,
        // BADGES-panelens stil bor i badges.css (flyttad från runner.css).
        bannedSelectors: ["/rq-badge-panel/"],
      }),
    },
    { files: ["src/shared/components/error-state.css"], rules: designRules({ locals: ["rq-edge", "rq-edge-line"] }) },
    {
      // Emblemets lokala mappning nivå/storlek → tokens (--rq-emblem-*) och chippets accent. Animationen får vara vilken som helst (andning,
      // tändning, skelettpuls), men ligger i no-preference-blocket (det prövar badges/guards.test.ts), och popupens knappar får aldrig en permanent ring.
      files: ["src/features/badges/badges.css"],
      rules: designRules({
        locals: [
          "rq-emblem-c", "rq-emblem-c-rgb", "rq-emblem-grad", "rq-emblem-w", "rq-emblem-h", "rq-emblem-icon", "rq-emblem-core", "rq-emblem-ring",
          "rq-emblem-ring-core", "rq-emblem-glow", "rq-emblem-glow-leg", "rq-emblem-ignite-from", "rq-c", "rq-c-solid",
        ],
        animations: ANY,
        bannedSelectors: [
          // Borttagna byggstenar (profilens samlingskort, den separata väljaren, panelens gamla rad) ska inte komma tillbaka.
          "/\\.rq-badge-(collection|display|pick|slot|textlink)/",
          "/\\.rq-badge-grid\\b/",
          "/\\.rq-badge-card__id|\\.rq-badge-skel-list|\\.rq-badge-empty__minis/",
          "/\\.rq-badge-panel__(row|text|nameline|display|held|list|name)\\b/",
          // Musfokus ska aldrig ge en ring på popupen: bara :focus-visible.
          "/rq-badge-popup.*:focus(?!-visible)/",
        ],
        extraRules: {
          // Council 20: "Got it" har ingen permanent guldring; fokus visas bara av den globala :focus-visible-ringen.
          "rule-selector-property-disallowed-list": [
            { "/^(?!.*:focus-visible).*rq-badge-popup__(btn|close)/": ["outline", "outline-offset", "box-shadow"] },
            { message: "Popupens knappar har ingen permanent ring (Council 20): fokus visas bara av den globala :focus-visible-ringen." },
          ],
        },
      }),
    },
    { files: ["src/features/challenges/duels.css"], rules: designRules({ locals: ["rq-duels-tier", "rq-duels-tier-fg", "rq-duels-tier-rgb", "rq-duels-tier-stroke", "rq-edge", "rq-edge-line"], zIndex: ["66"] }) },
    {
      // Ingen rörelse alls (varken animation eller @keyframes), ingen tonad text i --rq-text-5 (dekornivå, WCAG) och radien är alltid en token.
      files: ["src/features/changelog/changelog.css", "src/features/onboarding/whatsNew.css"],
      rules: designRules({ locals: ["rq-edge", "rq-edge-line", "rq-kind"], zeroRadius: false, bannedValues: ["/--rq-text-5/"], extraRules: keyframesBanned }),
    },
    {
      files: ["src/features/news/news.css"],
      rules: designRules({ locals: ["rq-c", "rq-c-edge", "rq-c-solid"], zeroRadius: false, bannedValues: ["/--rq-text-5/"], extraRules: keyframesBanned }),
    },
    {
      files: ["src/features/events/events.css"],
      rules: designRules({
        locals: ["rq-c", "rq-c-solid", "rq-edge", "rq-edge-line", "rq-events-accent", "rq-events-accent-rgb", "rq-events-week", "rq-ring-c"],
        animations: ["/^rqSweep 5s linear infinite$/"],
      }),
    },
    {
      // Bara levande saker loopar: rutnätet, löparna och deras XP-pop, kortets guldring och sweep. Reducerad rörelse hanteras av temafilens globala
      // regel, så landing.css sätter ingen egen animation-duration eller !important. "LEADERBOARD" bryts aldrig mitt i ordet.
      files: ["src/features/landing/landing.css"],
      rules: designRules({
        animations: [
          "/^rqGrid var\\(--rq-landing-grid-dur\\) linear infinite$/",
          "/^rqOrbit var\\(--rq-landing-lap-[1-6]\\) linear infinite$/",
          "/^rqLandingPop var\\(--rq-landing-lap-[1-6]\\) linear infinite$/",
          "/^rqRing var\\(--rq-landing-pulse\\) ease-in-out infinite$/",
          "/^rqSweep var\\(--rq-landing-sweep\\) linear infinite$/",
        ],
        bannedProperties: ["animation-duration", "overflow-wrap", "word-break"],
        extraRules: { "declaration-no-important": [true, { message: "landing.css sätter ingen !important; reducerad rörelse hanteras av temafilens globala regel." }] },
      }),
    },
    {
      files: ["src/features/leaderboard/board.css"],
      rules: designRules({
        // Lokala variabler pekar bara på andra tokens (rangens färger, nivåfärgerna, kortets kant) och sockelns mått.
        locals: ["rq-(?:rank-solid|rank-edge|rank-subtle|ring-c|tier-rgb|tier-stroke|tier-fg|acc|acc-edge|edge|edge-line)", "rq-board-plinth[a-z0-9-]*"],
        animations: ANY,
        bannedSelectors: ["/rq-board-namerow/"],
      }),
    },
    { files: ["src/features/log/log.css"], rules: designRules({ locals: ["rq-edge", "rq-edge-line", "rq-log-tone", "rq-log-tone-rgb"] }) },
    {
      files: ["src/features/profile/profile.css"],
      rules: designRules({
        // Redigeringsrutan ligger i skalets modallager (66). Bara markören och rutnätets veckor animerar, en gång var; inget loopar.
        animations: [
          "/^rqProfileKnob var\\(--rq-dur-bar\\) var\\(--rq-ease-bar\\) both$/",
          "/^rqGrowY var\\(--rq-dur-grow\\) var\\(--rq-ease-bar\\) both$/",
        ],
        zIndex: ["66"],
      }),
    },
    {
      // Skalet äger lagren (z-index), rörelsen och de äldre enhetslösa radhöjderna; för skalet gäller bara att mått, färger och hörn är tokens.
      files: ["src/app-shell/app-shell.css"],
      rules: designRules({ locals: ["rq-edge"], animations: ANY, zIndex: ANY, rawLineHeight: true }),
    },
  ],
};
