import { describe, expect, it } from 'vitest';
import { BADGE_SERIES, TIER_NAMES } from '@runquest/shared';

// Vakttester över badges-featuren (ADR 009): typerna kommer ur @runquest/shared, varje resurs har EN query-definition, och inga
// serienamn/texter är hårdkodade — allt om serierna läses ur shared (BADGE_SERIES, TIER_NAMES, requirementText, tierFlavor).
// Globben tar med framtida vyer (components/) automatiskt, så reglerna gäller även RUN-127 och framåt.

const sources = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./**/*.fixture.ts'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const codeFiles = Object.entries(sources);
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('badges-featuren: delade definitioner, inte egna kopior', () => {
  it('hittar filerna', () => {
    expect(codeFiles.map(([path]) => path).sort()).toEqual(expect.arrayContaining(['./api.ts', './badgeModel.ts', './hooks/useBadgeQueries.ts']));
  });

  it('typerna kommer ur @runquest/shared: ingen egen deklaration av kontraktstyperna', () => {
    const contract = /^\s*(export\s+)?(interface|type)\s+(BadgeUserItem|BadgeUserResponse|BadgeUserApiResponse|BadgeGroupMember|BadgeGroupResponse|BadgeGroupMeta|BadgeGroupApiResponse|BadgeShowcaseEntry|ShowcaseRequest|ShowcaseResponse|SeenRequest|SeenResponse|BadgeSeriesDef)\b/m;
    for (const [path, text] of codeFiles) expect({ path, own: contract.test(stripComments(text)) }).toEqual({ path, own: false });
  });

  it('inga hårdkodade serienamn, nycklar, tiernamn, flavors, måttetiketter eller kravtexter: allt läses ur shared', () => {
    const literals = new Set<string>([...TIER_NAMES]);
    for (const series of BADGE_SERIES) {
      literals.add(series.key);
      literals.add(series.name);
      literals.add(series.metricLabel);
      for (const flavor of series.flavors) literals.add(flavor);
    }
    for (const [path, text] of codeFiles) {
      const code = stripComments(text);
      const found = [...literals].filter((literal) => new RegExp(`['"\`]${literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`).test(code));
      expect({ path, found }).toEqual({ path, found: [] });
    }
  });

  it('klienten och endpoints bor i api.ts: bara api.ts nämner /badges/-sökvägar eller authenticatedRequest', () => {
    for (const [path, text] of codeFiles) {
      if (path === './api.ts') continue;
      const code = stripComments(text);
      expect({ path, endpoints: /['"`]\/badges\b/.test(code), request: /authenticatedRequest|\bfetch\(/.test(code) }).toEqual({ path, endpoints: false, request: false });
    }
  });
});

describe('badges-featuren: EN query-definition per resurs', () => {
  it('bara useBadgeQueries anropar badgesApi och skriver badges-nycklar; vyerna går via hookarna', () => {
    for (const [path, text] of codeFiles) {
      if (path === './hooks/useBadgeQueries.ts' || path === './api.ts') continue;
      const code = stripComments(text);
      expect({ path, api: /badgesApi/.test(code), keys: /\[\s*'badges'/.test(code), query: /\buse(Query|Mutation)\(/.test(code) }).toEqual({ path, api: false, keys: false, query: false });
    }
  });

  it('varje resurs har exakt en useQuery: användarens samling och gruppen', () => {
    const hooks = stripComments(sources['./hooks/useBadgeQueries.ts']);
    expect(hooks.match(/\buseQuery\(/g)).toHaveLength(2);
    expect(hooks.match(/queryFn:\s*\(\)\s*=>\s*badgesApi\.(\w+)/g)?.sort()).toEqual([
      'queryFn: () => badgesApi.getGroupBadges', 'queryFn: () => badgesApi.getUserBadges',
    ]);
  });

  it('mutationerna är optimistiska med återställning: onMutate, onError och invalidering finns', () => {
    const hooks = stripComments(sources['./hooks/useBadgeQueries.ts']);
    expect(hooks.match(/onMutate/g)?.length).toBe(2);
    expect(hooks.match(/onError/g)?.length).toBe(2);
    expect(hooks).toMatch(/invalidateQueries/);
  });

  it('cachen är användarbunden: user-nyckeln bär användar-id:t och ingen nyckel utan id skrivs för min samling', () => {
    const hooks = stripComments(sources['./hooks/useBadgeQueries.ts']);
    expect(hooks).toMatch(/user:\s*\(userId: string\)\s*=>\s*\['badges', 'user', userId\]/);
  });
});

describe('badges-featuren: språk och UI-regler som gäller även logiken', () => {
  it('engelskt UI i en-GB: ingen sv-SE, inga toast-anrop och inga Intl-datumformat', () => {
    for (const [path, text] of codeFiles) {
      const code = stripComments(text);
      expect({
        path, svSE: /sv-SE/.test(code), toast: /\btoast[.(]|from ['"]sonner['"]/.test(code), locale: /toLocale(Date|Time)?String|Intl\.DateTimeFormat/.test(code),
      }).toEqual({ path, svSE: false, toast: false, locale: false });
    }
  });

  it('ingen lucide-import, inga egna <svg> och inga emojis i texterna (RQIcon är enda ikonkällan, regel 10)', () => {
    for (const [path, text] of codeFiles) {
      const code = stripComments(text);
      expect({ path, lucide: /lucide-react/.test(code), svg: /<svg/.test(code), emoji: code.match(/\p{Extended_Pictographic}/gu) ?? [] }).toEqual({
        path, lucide: false, svg: false, emoji: [],
      });
    }
  });
});
