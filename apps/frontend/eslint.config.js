import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// ─── Arkitekturgränser (RUN-154) ─────────────────────────────────────────────────────────────────────────────────────────────────
// Dessa regler låg tidigare som källtextvakter i guards.test.ts (regex mot ?raw-källor). Som lint fäller de vid skrivandet,
// inte först i testkörningen. Gränserna gäller produktionskoden: testfiler och fixtures är undantagna, precis som vakterna var.
//
// ESLint ersätter en regels hela inställning när flera block träffar samma fil (de slås inte ihop). Därför byggs varje featureblock
// ur de gemensamma listorna nedan, och en fil ska bara träffas av ETT block per regel.

const NOT_PRODUCTION = ["**/*.test.{ts,tsx}", "**/*.fixture.ts"];

// Lazy-gränsen (ADR 006 beslut 11): de här sidorna och onboarding-orkestratorn laddas bara via lazy(() => import(...)).
// no-restricted-imports granskar statiska importer; dynamisk import() faller utanför, så lazy() i routes.tsx/App.tsx är tillåten.
const LAZY_ONLY = {
  regex: "(^@/pages/|^\\.\\.?/(.*/)?pages/|^\\./)(Index|\\w+PreviewPage|AdminPage|PlaybookPage|FeaturesPage|SettingsPage|LegalPage)$|(^|/)OnboardingOrchestrator$",
  message: "Importeras bara via lazy(() => import(...)) (ADR 006 beslut 11) — en statisk import drar in sidan i huvudbunten.",
};

// En källa för det gruppen ser: bara features/changelog/changelogData.ts läser changelog.json.
const CHANGELOG_JSON = {
  regex: "(^|/)changelog\\.json$",
  message: "Bara features/changelog/changelogData.ts läser changelog.json; övriga går via changelogData.",
};

const STREAK_CONSTANTS = {
  regex: "streakConstants",
  message: "Multiplikatortrappan kommer ur config-endpointen (/api/config/xp), inte ur en konstant.",
};

const GLOBAL_IMPORT_PATTERNS = [LAZY_ONLY, CHANGELOG_JSON];

const importRestrictions = (...extraPatterns) => ["error", { patterns: [...GLOBAL_IMPORT_PATTERNS, ...extraPatterns] }];

// Multiplikatortrappan i Board/Profile/Runner kommer ur config-endpointen, aldrig ur shared-defaultvärdena.
const NO_STREAK_DEFAULTS = {
  selector: "Identifier[name=/STREAK_MULTIPLIERS/]",
  message: "Multiplikatortrappan kommer ur config-endpointen (useXpConfig), inte ur DEFAULT_STREAK_MULTIPLIERS.",
};

// Landing är publik och gör inga anrop (ägarbeslut 4) och importerar inget ur auth: dialogen monteras av pages/Index.
const LANDING_IMPORTS = [
  STREAK_CONSTANTS,
  { regex: "backendApi|(^|/)services/|react-query|supabase|axios", message: "Landing-featuren gör inga anrop (ägarbeslut 4): hårdskriven data, ingen backend." },
  // Täcker både alias (@/features/auth, @/providers/auth) och relativa importer (../auth/foo, ../../providers/authContext).
  { regex: "features/auth|providers/auth|(^|/)\\.\\.?/(.*/)?auth/", message: "Landing importerar inget ur features/auth eller providers/auth; dialogen monteras av pages/Index." },
];
const LANDING_SYNTAX = [
  { selector: "CallExpression[callee.name='fetch']", message: "Landing-featuren gör inga anrop (ägarbeslut 4)." },
  {
    selector: "Identifier[name=/^(useUsersWithRuns|useXpConfig|useGroupName|useQuery|useMutation|useAuth)$/]",
    message: "Landing-featuren hämtar ingen data (ägarbeslut 4): inga datahooks och ingen auth.",
  },
];

// Badges (ADR 009): kontraktstyperna kommer ur @runquest/shared, api.ts är enda klienten, useBadgeQueries enda query-definitionen.
const BADGE_CONTRACT_TYPES = "BadgeUserItem|BadgeUserResponse|BadgeUserApiResponse|BadgeGroupMember|BadgeGroupResponse|BadgeGroupMeta|BadgeGroupApiResponse|BadgeShowcaseEntry|ShowcaseRequest|ShowcaseResponse|SeenRequest|SeenResponse|BadgeSeriesDef";
const BADGE_SHARED_TYPES = [
  {
    selector: `TSInterfaceDeclaration[id.name=/^(${BADGE_CONTRACT_TYPES})$/]`,
    message: "Kontraktstyperna kommer ur @runquest/shared; deklarera dem inte om i badges-featuren.",
  },
  {
    selector: `TSTypeAliasDeclaration[id.name=/^(${BADGE_CONTRACT_TYPES})$/]`,
    message: "Kontraktstyperna kommer ur @runquest/shared; deklarera dem inte om i badges-featuren.",
  },
];
const BADGE_CLIENT_STAYS_IN_API = [
  // esquery stoppar regexen vid första `/`, även escapad; snedstrecket skrivs därför \x2f.
  { selector: "Literal[value=/^\\x2fbadges\\b/]", message: "Badges-endpoints bor i features/badges/api.ts." },
  { selector: "TemplateElement[value.raw=/^\\x2fbadges\\b/]", message: "Badges-endpoints bor i features/badges/api.ts." },
  { selector: "Identifier[name='authenticatedRequest']", message: "Bara features/badges/api.ts anropar klienten (authenticatedRequest)." },
  { selector: "CallExpression[callee.name='fetch']", message: "Bara features/badges/api.ts anropar servern." },
];
const BADGE_QUERIES_STAY_IN_HOOK = [
  { selector: "Identifier[name='badgesApi']", message: "Vyerna går via hookarna i hooks/useBadgeQueries.ts, inte direkt mot badgesApi." },
  { selector: "ArrayExpression > Literal:first-child[value='badges']", message: "Query-nycklarna för badges skrivs bara i hooks/useBadgeQueries.ts." },
  { selector: "CallExpression[callee.name=/^use(Query|Mutation)$/]", message: "EN query-definition per resurs: useQuery/useMutation för badges finns bara i hooks/useBadgeQueries.ts." },
];

// ─── Designregler (RUN-223) ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Dessa regler låg tidigare som källtextvakter (src/test/designGuards.ts och inklistrade kopior i guards.test.ts per feature). Som lint
// fäller de vid skrivandet. CSS-delen av designspråket ligger i stylelint.config.js, token-synken i src/test/themeTokens.sync.test.ts.
//
// Egen regel (`rq/design-syntax`) i stället för no-restricted-syntax: ESLint ersätter en regels hela inställning när flera block träffar
// samma fil, och badges/landing/leaderboard/profile/runner har redan arkitekturlistor i no-restricted-syntax. Designreglerna är samma
// selektorer, men lever sida vid sida med dem i stället för att bygga in sig i varje lista.

const designSyntax = {
  meta: {
    type: "problem",
    schema: {
      type: "array",
      items: { type: "object", required: ["selector", "message"], properties: { selector: { type: "string" }, message: { type: "string" } }, additionalProperties: false },
    },
  },
  create(context) {
    const listeners = {};
    for (const { selector, message } of context.options) {
      const previous = listeners[selector];
      listeners[selector] = (node) => {
        previous?.(node);
        context.report({ node, message });
      };
    }
    return listeners;
  },
};
const rqPlugin = { rules: { "design-syntax": designSyntax } };

/** En regel på tre nodtyper: strängliteral, mallsträng och JSX-text (UI-text kan stå i alla tre). */
const textRule = (message, pattern, flags = "") => [
  { selector: `Literal[value=/${pattern}/${flags}]`, message },
  { selector: `TemplateElement[value.raw=/${pattern}/${flags}]`, message },
  { selector: `JSXText[value=/${pattern}/${flags}]`, message },
];
const syntaxRule = (message, ...selectors) => selectors.map((selector) => ({ selector, message }));
// En className-sträng eller mallsträng någonstans under className={…}.
const inClassName = (pattern) => `JSXAttribute[name.name='className'] :matches(Literal[value=/${pattern}/], TemplateElement[value.raw=/${pattern}/])`;

// Reglerna som gäller varje designad vy (nyckel = namn som en grupp kan stänga av med `omit`).
const DESIGN = {
  svg: syntaxRule("Inga egna <svg>: ikoner ritas av RQIcon/RQLogo (regel 10).", "JSXOpeningElement[name.name='svg']"),
  emoji: textRule("Inga emojis i UI-texten (regel 10).", "\\p{Extended_Pictographic}", "u"),
  locale: [
    ...textRule("Engelskt UI i en-GB: ingen sv-SE.", "sv-SE"),
    ...syntaxRule(
      "Engelskt UI i en-GB: inga Intl-/toLocale-datumformat; månadsnamnen är egna (Intl ger \"Sept\" i nyare ICU).",
      "MemberExpression[property.name=/^toLocale(Date|Time)?String$/]",
      "MemberExpression[object.name='Intl'][property.name='DateTimeFormat']",
    ),
  ],
  // no-restricted-imports granskar statiska importer; import() och require() fångas här.
  dynamicImports: syntaxRule(
    "Ikoner kommer ur RQIcon och bekräftelser står i statusregioner: inget lucide-react, sonner eller shadcn-primitiv, inte ens via import().",
    "ImportExpression[source.value=/^(lucide-react|sonner)(\\x2f|$)|components\\x2fui(\\x2f|$)/]",
    "CallExpression[callee.name='require'][arguments.0.value=/^(lucide-react|sonner)(\\x2f|$)|components\\x2fui(\\x2f|$)/]",
  ),
  toast: syntaxRule("Bekräftelser står i statusregioner (role=status/alert), inte i toast().", "CallExpression[callee.name='toast']", "CallExpression[callee.object.name='toast']"),
  colors: [
    ...textRule("Inga hex-färger i koden: färger kommer ur tokens (regel 1).", "#[0-9a-fA-F]{3,8}\\b"),
    ...textRule("Inga rgb()/rgba() i koden: färger kommer ur tokens (regel 1).", "rgba?\\("),
  ],
  pxInClassName: syntaxRule("Inga px-mått i className: mått kommer ur --rq-*-tokens (regel 1).", inClassName("[\\d.]+px")),
};
// Inline-styles. Dynamiska värden går bara via cssVars() (CSS-variabler); featurer som aldrig haft något dynamiskt värde förbjuder style helt.
const STYLE = {
  none: syntaxRule("Inga inline-styles (regel 1).", "JSXAttribute[name.name='style']"),
  cssVars: syntaxRule("Inga inline-styles: dynamiska värden går bara via cssVars() (CSS-variabler).", "JSXAttribute[name.name='style']:not([value.expression.callee.name='cssVars'])"),
  // Board har aldrig vaktats mer än mot ett objekt direkt i JSX (style={{ … }}); variabelobjekten byggs av hjälpare i komponenterna.
  noLiteral: syntaxRule("Inga inline-styles: dynamiska värden går bara via CSS-variabler, aldrig style={{ … }}.", "JSXAttribute[name.name='style'] > JSXExpressionContainer > ObjectExpression"),
};
// Gäller all produktionskod: den gamla sköldens path (utmaningstecknet är en vimpel, F12.4) och kända trasiga rester.
const DESIGN_EVERYWHERE = [
  ...textRule("Den gamla sköldens path får inte finnas kvar: utmaningstecknet är vimpeln ur shared/components/challengeMark.", "H\\s*24\\.5\\s*V\\s*21\\b|V\\s*21\\s*L\\s*13\\s*30\\.5"),
  ...textRule("Kända trasiga rester: hsl(var(--sidebar)), var(--rq-foreground) och Silkscreen finns inte längre.", "hsl\\(var\\(--sidebar\\)\\)|var\\(--rq-foreground\\)|silkscreen", "i"),
];
const designImports = ({ sonner = false } = {}) => [
  "error",
  {
    patterns: [
      { group: ["lucide-react", "lucide-react/**"], message: "Ikoner kommer ur RQIcon, inte lucide-react (regel 10)." },
      ...(sonner ? [] : [{ group: ["sonner", "sonner/**"], message: "Bekräftelser står i statusregioner (role=status/alert), inte i toasts." }]),
      { group: ["**/components/ui", "**/components/ui/**"], message: "Designade vyer använder inte shadcn-primitiverna i shared/components/ui." },
    ],
  },
];

// Varje designgrupp (och icons/loaders-blocket) anmäler sig här. src/test/lintScope.test.ts läser listan och fäller om en glob inte längre
// matchar någon fil, eller om en feature saknar grupp: lint som tyst slutat gälla är värre än en vakt som fäller.
export const DESIGN_GROUPS = [];
const registerDesignGroup = (block) => {
  DESIGN_GROUPS.push({ files: block.files, ignores: block.ignores });
  return block;
};

/**
 * @param {string[]} files
 * @param {object} [options]
 * @param {"none"|"cssVars"|"noLiteral"} [options.style] Hur strikt inline-style är förbjudet. Default "cssVars".
 * @param {string[]} [options.omit] Nycklar i DESIGN som inte gäller gruppen (ett dokumenterat undantag).
 * @param {object[]} [options.extra] Regler som bara gäller gruppen.
 * @param {string[]} [options.ignores] Filer som ligger i ett eget undantagsblock.
 * @param {boolean} [options.allowSonner] Filen får importera sonner (ett dokumenterat undantag).
 */
const designGroup = (files, { style = "cssVars", omit = [], extra = [], ignores = [], allowSonner = false } = {}) => registerDesignGroup({
  files,
  ignores: [...NOT_PRODUCTION, ...ignores],
  rules: {
    "rq/design-syntax": [
      "error",
      ...Object.entries(DESIGN).filter(([key]) => !omit.includes(key)).flatMap(([, rules]) => rules),
      ...STYLE[style],
      ...DESIGN_EVERYWHERE,
      ...extra,
    ],
    "@typescript-eslint/no-restricted-imports": designImports({ sonner: allowSonner }),
  },
});

// Innehållsregler som hör till en enskild vy.
const NO_XP_NUMBERS = textRule("Inga hårdkodade XP-siffror i Playbook-komponenterna: allt går via playbookModel och config.", "\\b\\d+ XP\\b|\\d+ XP\\x2fkm");
const NO_GLOBAL_STATS = [
  // O2 (ägarbeslut 2026-10-11, spec F9.12): ingen global procent. Räknaren är bara "Held by X of N in your pack".
  ...textRule("Ingen global procent (O2): \"globally\" får inte finnas.", "globally", "i"),
  ...textRule("Ingen global procent (O2): \"has it\" får inte finnas.", "\\bhas it\\b", "i"),
  ...textRule("Ingen procent i badges-texten (O2, L9). Modulo och CSS ligger utanför.", "%"),
  ...textRule("\"in pack\" skrivs aldrig utan \"your\" (\"in your pack\" överallt).", "in pack\\b", "i"),
];
const CHANGELOG_EXTRA = [
  ...syntaxRule(
    "Changelog-vyn använder featurens egna klasser, inte tailwind.",
    inClassName("(^|\\s)(?:flex|grid|p[xytblr]?-\\d|m[xytblr]?-\\d|text-(?:xs|sm|lg|foreground)|bg-|border-\\[|w-\\d|h-\\d|gap-\\d|rounded)"),
  ),
  // Datumen står som text i changelog.json; inget Date-objekt formaterar dem.
  ...syntaxRule("Datumen står som text i changelog.json: inget new Date().", "NewExpression[callee.name='Date']"),
];
const NO_NUMBER_FORMAT = syntaxRule("Landing formaterar inte tal med Intl (texten är hårdskriven).", "MemberExpression[object.name='Intl'][property.name='NumberFormat']");
const NO_NAMEROW = textRule("Den gamla namnraden för tabellen (.rq-board-namerow) är borta.", "rq-board-namerow");
const NO_RQ_DOT = textRule("Olästpricken är statisk: de delade prick-varianterna .rq-dot--live/--alarm blinkar.", "rq-dot--");

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": ["warn", {
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_",
        "ignoreRestSiblings": true
      }],
    },
  },

  // Gränser för all produktionskod: lazy-sidorna och changelog.json (changelogData.ts får läsa JSON-filen).
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [...NOT_PRODUCTION, "src/features/changelog/changelogData.ts"],
    rules: { "no-restricted-imports": importRestrictions() },
  },
  {
    files: ["src/features/changelog/changelogData.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [LAZY_ONLY] }] },
  },

  // Board, Profile och Runner: trappan ur config-endpointen.
  {
    files: [
      "src/features/leaderboard/**/*.{ts,tsx}", "src/pages/BoardPage.tsx", "src/shared/components/ViewTabs.tsx", "src/shared/components/ErrorState.tsx",
      "src/shared/hooks/useViewParam.ts", "src/shared/hooks/useXpConfig.ts",
      "src/features/profile/**/*.{ts,tsx}", "src/features/runs/**/*.{ts,tsx}", "src/pages/ProfilePage.tsx",
      "src/features/runner/**/*.{ts,tsx}", "src/pages/RunnerPage.tsx",
    ],
    ignores: NOT_PRODUCTION,
    rules: {
      "no-restricted-imports": importRestrictions(STREAK_CONSTANTS),
      "no-restricted-syntax": ["error", NO_STREAK_DEFAULTS],
    },
  },

  // Landing: publik, inga anrop, ingen auth, trappan ur shared (DEFAULT_STREAK_MULTIPLIERS är tillåten här men inte streakConstants).
  {
    files: ["src/features/landing/**/*.{ts,tsx}", "src/pages/LandingPage.tsx"],
    ignores: NOT_PRODUCTION,
    rules: {
      "no-restricted-imports": importRestrictions(...LANDING_IMPORTS),
      "no-restricted-syntax": ["error", ...LANDING_SYNTAX],
    },
  },

  // Badges: tre block eftersom no-restricted-syntax ersätts per fil. api.ts får allt klientrelaterat, useBadgeQueries.ts får query-definitionerna.
  {
    files: ["src/features/badges/**/*.{ts,tsx}"],
    ignores: [...NOT_PRODUCTION, "src/features/badges/api.ts", "src/features/badges/hooks/useBadgeQueries.ts"],
    rules: { "no-restricted-syntax": ["error", ...BADGE_SHARED_TYPES, ...BADGE_CLIENT_STAYS_IN_API, ...BADGE_QUERIES_STAY_IN_HOOK] },
  },
  {
    files: ["src/features/badges/hooks/useBadgeQueries.ts"],
    rules: { "no-restricted-syntax": ["error", ...BADGE_SHARED_TYPES, ...BADGE_CLIENT_STAYS_IN_API] },
  },
  {
    files: ["src/features/badges/api.ts"],
    rules: { "no-restricted-syntax": ["error", ...BADGE_SHARED_TYPES] },
  },

  // ─── Designregler (RUN-223) ────────────────────────────────────────────────────────────────────────────────────────────────────────
  // Varje designad vy är en grupp med exakt en lista (en fil ska bara träffas av ETT block för rq/design-syntax). Filerna är de som
  // vakterna tidigare globbade: featuren, dess sida och de delade filer featuren äger.
  { files: ["src/**/*.{ts,tsx}"], plugins: { rq: rqPlugin } },
  // Resten av produktionskoden: bara det som gäller överallt.
  { files: ["src/**/*.{ts,tsx}"], ignores: NOT_PRODUCTION, rules: { "rq/design-syntax": ["error", ...DESIGN_EVERYWHERE] } },

  designGroup(["src/features/admin/**/*.{ts,tsx}", "src/pages/AdminPage.tsx"], { style: "none" }),
  designGroup(["src/features/auth/**/*.{ts,tsx}"], { style: "none" }),
  designGroup(["src/features/settings/**/*.{ts,tsx}", "src/pages/SettingsPage.tsx"], { style: "none" }),
  designGroup(["src/shared/components/form/**/*.{ts,tsx}"], { style: "none" }),
  // Playbook: siffrorna är inte hårdkodade i komponenterna och sidan; modellen får formulera dem ur config.
  designGroup(["src/features/playbook/**/*.{ts,tsx}"], { style: "none", ignores: ["src/features/playbook/components/**"] }),
  designGroup(["src/features/playbook/components/**/*.{ts,tsx}", "src/pages/PlaybookPage.tsx"], { style: "none", extra: NO_XP_NUMBERS }),
  designGroup(["src/features/badges/**/*.{ts,tsx}", "src/pages/BadgesPreviewPage.tsx"], { style: "none", extra: NO_GLOBAL_STATS }),
  designGroup(["src/features/log/**/*.{ts,tsx}", "src/pages/LogPage.tsx"], { style: "none" }),
  designGroup(["src/features/news/**/*.{ts,tsx}", "src/app-shell/NotificationsPopover.tsx", "src/pages/NewsPage.tsx"], { style: "none", extra: NO_RQ_DOT }),
  designGroup(["src/features/changelog/**/*.{ts,tsx}", "src/pages/FeaturesPage.tsx", "src/features/onboarding/components/PatchNotesModal.tsx"], { style: "none", extra: CHANGELOG_EXTRA }),
  designGroup(["src/features/events/**/*.{ts,tsx}", "src/pages/EventsPage.tsx"]),
  designGroup(["src/features/landing/**/*.{ts,tsx}", "src/pages/LandingPage.tsx"], { extra: NO_NUMBER_FORMAT, ignores: ["src/features/landing/components/ArenaTrack.tsx"] }),
  designGroup(["src/features/challenges/**/*.{ts,tsx}", "src/pages/DuelsPage.tsx"], { ignores: ["src/features/challenges/components/TierRibbon.tsx"] }),
  designGroup(
    [
      "src/features/leaderboard/**/*.{ts,tsx}", "src/pages/BoardPage.tsx", "src/shared/components/ViewTabs.tsx", "src/shared/components/ErrorState.tsx",
      "src/shared/hooks/useViewParam.ts", "src/shared/hooks/useXpConfig.ts",
    ],
    {
      style: "noLiteral", extra: NO_NAMEROW,
      ignores: ["src/features/leaderboard/boardFormat.ts", "src/features/leaderboard/components/BoardParts.tsx", "src/features/leaderboard/hooks/useLeaderboardData.ts"],
    },
  ),
  designGroup(["src/features/profile/**/*.{ts,tsx}", "src/features/runs/**/*.{ts,tsx}", "src/pages/ProfilePage.tsx"]),
  designGroup(["src/features/runner/**/*.{ts,tsx}", "src/pages/RunnerPage.tsx"]),
  designGroup(["src/features/titles/**/*.{ts,tsx}", "src/pages/TitlesPage.tsx"], { ignores: ["src/features/titles/titleFormat.ts"] }),
  designGroup(["src/features/legal/**/*.{ts,tsx}", "src/pages/LegalPage.tsx"]),
  designGroup(
    [
      "src/app-shell/*.{ts,tsx}", "src/paths.ts", "src/routes.tsx", "src/pages/Index.tsx", "src/pages/NotFound.tsx", "src/shared/components/EmptyState.tsx",
    ],
    { ignores: ["src/app-shell/NotificationsPopover.tsx"] },
  ),
  // icons/ och loaders/: regel 1 för className (inga råa px, varken som mått eller som Tailwind-hakparentes).
  registerDesignGroup({
    files: ["src/shared/components/icons/**/*.{ts,tsx}", "src/shared/components/loaders/**/*.{ts,tsx}"],
    ignores: NOT_PRODUCTION,
    rules: {
      "rq/design-syntax": [
        "error",
        ...DESIGN.pxInClassName,
        ...syntaxRule("Inga px-mått i Tailwind-hakparenteser (w-[22px]): mått kommer ur --rq-*-tokens (regel 1).", "Literal[value=/[a-z-]+-\\[[^\\]]*[\\d.]+px[^\\]]*\\]/]"),
        ...DESIGN_EVERYWHERE,
      ],
    },
  }),

  // Undantag: en enda fil får rita en <svg> eller en path.
  // Duels vimpel är en egen form, inte en ikon: den ritas ur den delade geometrin (challengeMark), aldrig med en egen path.
  designGroup(["src/features/challenges/components/TierRibbon.tsx"], {
    omit: ["svg"],
    extra: syntaxRule("Vimpeln ritas ur den delade geometrin (challengeMark, PENNANT_PATH), inte med en egen path.", "JSXAttribute[name.name='d'] > Literal"),
  }),
  // Arenabanan är dekor: en <svg> är tillåten, men filen måste dölja den för skärmläsare (aria-hidden på banan).
  designGroup(["src/features/landing/components/ArenaTrack.tsx"], {
    omit: ["svg"],
    extra: [
      ...NO_NUMBER_FORMAT,
      ...syntaxRule("Arenabanan är dekor och måste vara dold för skärmläsare (aria-hidden=\"true\").", "Program:not(:has(JSXAttribute[name.name='aria-hidden']))"),
    ],
  }),
  // Kända luckor som vakterna aldrig täckte och som finns kvar (ingen kodändring i det här steget). Varje fil har bara det enda undantaget.
  // - boardFormat.ts: tusentalsmellanrummet "1 126" kommer ur toLocaleString('sv-SE').
  // - BoardParts.tsx: vimpeln ritas som en <svg> ur den delade geometrin (challengeMark).
  // - useLeaderboardData.ts: ett toast.error vid hämtningsfel.
  // - titleFormat.ts: dagen skrivs med toLocaleDateString('en-GB', { timeZone: 'UTC' }).
  designGroup(["src/features/leaderboard/boardFormat.ts"], { style: "noLiteral", extra: NO_NAMEROW, omit: ["locale"] }),
  designGroup(["src/features/leaderboard/components/BoardParts.tsx"], { style: "noLiteral", extra: NO_NAMEROW, omit: ["svg"] }),
  designGroup(["src/features/leaderboard/hooks/useLeaderboardData.ts"], { style: "noLiteral", extra: NO_NAMEROW, omit: ["toast"], allowSonner: true }),
  designGroup(["src/features/titles/titleFormat.ts"], { omit: ["locale"] }),

  // Loggning går via logger (en enda plats att styra nivåer/maskering), aldrig console.* direkt.
  { files: ["src/shared/services/backendApi.ts"], rules: { "no-console": "error" } },
);
