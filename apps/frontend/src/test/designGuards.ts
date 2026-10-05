import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Vakttester för designspråkets maskinkontrollerbara regler (docs/design/designsprak-forslag.md), delade av de features som
// ritades om i inkrement 11 (Settings, Admin, Playbook, Login + formulärkitet). Varje feature skickar in sina egna filer:
//   defineDesignGuards({ name, baseUrl: import.meta.url, sources: import.meta.glob([...], { query: '?raw', import: 'default', eager: true }),
//                        cssFiles: ['./x.css'], tokenPrefix: '--rq-x-' })
// Regel 1 (tokens), 2 (skarpa hörn), 8 (rörelse), 10 (ikoner ur RQIcon, inga emojis) + inga shadcn-primitiver/toasts + tokensynk mellan
// index.css och docs/design/temafil-forslag.css.

interface GuardOptions {
  name: string;
  /** `import.meta.url` i testfilen — CSS och temafilerna läses från disk relativt den. */
  baseUrl: string;
  /** Källfilerna (utan tester): sökväg → text, ur `import.meta.glob(..., { query: '?raw', import: 'default', eager: true })`. */
  sources: Record<string, string>;
  /** CSS-filer relativt testfilen. Läses från disk: vitest (css: false) tömmer ?raw-importer av .css. */
  cssFiles: string[];
  /** Måtten featuren äger i temafilen ("--rq-settings-"). Utelämnad = featuren har inga egna mått. */
  tokenPrefix?: string;
  /** Egna custom properties CSS-filerna får deklarera (kortets kant- och tonvariabler m.fl.). */
  localVars?: string[];
  /** Tillåter `animation:` i CSS (annars har featuren ingen egen rörelse). */
  allowAnimation?: boolean;
}

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

export function defineDesignGuards({ name, baseUrl, sources, cssFiles, tokenPrefix, localVars = [], allowAnimation = false }: GuardOptions): void {
  const readFromDisk = (relative: string) => readFileSync(fileURLToPath(new URL(relative, baseUrl)), 'utf8');
  const codeFiles = Object.entries(sources);
  const css = cssFiles.map((file) => ({ file, text: readFromDisk(file) }));
  // Skalets egna @media-block hålls utanför px-kontrollen (mediafrågor har brytpunkter), men deras innehåll granskas.
  const cssCode = (text: string) => stripComments(text).replace(/@media[^{]*\{/g, '{');

  describe(`${name} följer designspråket`, () => {
    it('hittar filerna', () => {
      expect(codeFiles.length).toBeGreaterThan(0);
      for (const { file, text } of css) expect({ file, long: text.length > 200 }).toEqual({ file, long: true });
    });

    it('ingen lucide-import, inga shadcn-primitiver, inga egna <svg> (RQIcon/RQLogo är ikonkällan) och inga toasts', () => {
      for (const [path, text] of codeFiles) {
        expect({
          path,
          lucide: /lucide-react/.test(text),
          shadcn: /shared\/components\/ui\//.test(text),
          svg: /<svg/.test(text),
          toast: /from ['"]sonner['"]/.test(text),
        }).toEqual({ path, lucide: false, shadcn: false, svg: false, toast: false });
      }
    });

    it('inga emojis i UI-texten (regel 10)', () => {
      for (const [path, text] of codeFiles) {
        expect({ path, emoji: stripComments(text).match(/\p{Extended_Pictographic}/gu) ?? [] }).toEqual({ path, emoji: [] });
      }
    });

    it('engelskt UI i en-GB: ingen sv-SE, inga Intl-/toLocale-datumformat (månadsnamnen är egna)', () => {
      for (const [path, text] of codeFiles) {
        const code = stripComments(text);
        expect({ path, svSE: /sv-SE/.test(code), locale: /toLocale(Date|Time)?String|Intl\.DateTimeFormat/.test(code) }).toEqual({ path, svSE: false, locale: false });
      }
    });

    it('inga hex, rgba() eller px i klassnamn', () => {
      for (const [path, text] of codeFiles) {
        const code = stripComments(text);
        const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
        const rgba = code.match(/rgba?\(/g) ?? [];
        const pxInClass = (code.match(/className=(?:"[^"]*"|\{[^}]*\})/g) ?? []).filter((c) => /[\d.]+px/.test(c));
        expect({ path, hex, rgba, pxInClass }).toEqual({ path, hex: [], rgba: [], pxInClass: [] });
      }
    });

    it('inga inline-styles', () => {
      for (const [path, text] of codeFiles) {
        expect({ path, inline: stripComments(text).match(/style=\{/g) ?? [] }).toEqual({ path, inline: [] });
      }
    });

    it('CSS: bara tokens — px, hex och rgba() finns inte, och inga hörn utom radie 0 / token', () => {
      for (const { file, text } of css) {
        const code = cssCode(text);
        expect({
          file,
          px: code.match(/[\d.]+px/g) ?? [],
          hex: code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [],
          // rgb(var(--rq-…-rgb) / alfa) är det sanktionerade alfa-receptet; bokstavliga rgb()/rgba() är det inte.
          rgba: code.match(/rgba\(|rgb\(\s*\d/g) ?? [],
          radius: [...code.matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1].trim()).filter((value) => value !== '0' && !value.startsWith('var(--rq-radius')),
        }).toEqual({ file, px: [], hex: [], rgba: [], radius: [] });
      }
    });

    it('CSS: inga egna :root-definitioner och bara de lokala variablerna som är tillåtna', () => {
      for (const { file, text } of css) {
        const code = stripComments(text);
        expect({ file, root: /:root/.test(code) }).toEqual({ file, root: false });
        const declared = [...code.matchAll(/(?:^|[{;])\s*(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
        expect({ file, declared: [...new Set(declared)].sort() }).toEqual({ file, declared: [...new Set(declared)].filter((v) => localVars.includes(v)).sort() });
      }
    });

    it('CSS: line-height och font-family kommer ur tokens, inget z-index', () => {
      for (const { file, text } of css) {
        const code = stripComments(text);
        const lineHeights = [...code.matchAll(/line-height:\s*([^;}]+)/g)].map((m) => m[1].trim());
        const families = [...code.matchAll(/font-family:\s*([^;}]+)/g)].map((m) => m[1].trim());
        expect({
          file,
          lineHeights: lineHeights.filter((value) => !value.startsWith('var(--rq-lh-')),
          families: families.filter((family) => !family.startsWith('var(--rq-font-')),
          zIndex: [...code.matchAll(/z-index:\s*([^;}]+)/g)].map((m) => m[1].trim()),
        }).toEqual({ file, lineHeights: [], families: [], zIndex: [] });
      }
    });

    it(allowAnimation ? 'rörelse: inga transitions eller hover-animationer' : 'rörelse: ingen egen — inga animationer, inga transitions', () => {
      for (const { file, text } of css) {
        const code = stripComments(text);
        expect({ file, transition: /transition\s*:/.test(code), animation: !allowAnimation && /animation\s*:/.test(code) }).toEqual({ file, transition: false, animation: false });
      }
    });

    if (tokenPrefix) {
      it(`varje ${tokenPrefix}*-mått som CSS:en läser finns i temafilen (index.css) OCH i docs/design/temafil-forslag.css — och tvärtom`, () => {
        const escaped = tokenPrefix.replace(/[-]/g, '\\-');
        const used = new Set(css.flatMap(({ text }) => [...text.matchAll(new RegExp(`var\\((${escaped}[a-z0-9-]+)\\)`, 'g'))].map((m) => m[1])));
        expect(used.size).toBeGreaterThan(0);

        const declared = (text: string) => new Set([...text.matchAll(new RegExp(`^\\s*(${escaped}[a-z0-9-]+):`, 'gm'))].map((m) => m[1]));
        const srcDir = fileURLToPath(baseUrl).replace(/[\\/]src[\\/].*$/, '/src');
        const index = declared(readFileSync(`${srcDir}/index.css`, 'utf8'));
        const facit = declared(readFileSync(`${srcDir}/../../../docs/design/temafil-forslag.css`, 'utf8'));

        for (const token of used) expect({ token, index: index.has(token), facit: facit.has(token) }).toEqual({ token, index: true, facit: true });
        // Ett mått som ingen läser är en kvarglömd token.
        for (const token of index) expect({ token, used: used.has(token) }).toEqual({ token, used: true });
        expect([...index].sort()).toEqual([...facit].sort());
      });
    }
  });
}
