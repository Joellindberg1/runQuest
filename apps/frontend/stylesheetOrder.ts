// Kaskadordningen mellan temat och resten av CSS:en, bestämd per HTML-ingång (RUN-331, integrationskritiken).
//
// Före förrenderingen var appen en enda stilmall: temat (src/index.css: Tailwind, tokens, den globala fokusringen) kom sist, efter vendor- och feature-CSS, och
// vann därför över dem vid lika specificitet (driver.js `.driver-popover-close-btn { all: unset }` mot temats `:focus-visible`). Med två ingångar delar
// landningen och appen index.css, så Rollup lägger den i en egen fil (manualChunks `theme`), och Vite länkar delade filer före ingångens egen CSS: temat
// hamnade först i appen och driver.js vann över fokusringen. Ordningen är alltså ett krav per ingång, inte en slump i chunkningen:
//   - index.html:   temat sist (som appen alltid haft det)
//   - landing.html: temat först (landningen har alltid haft temat före landnings-CSS:en, som lazy-laddades efter ingångens CSS)
// Saknas temafilen i en HTML-fil faller bygget, så att en omdöpt chunk inte tyst ger tillbaka fel ordning. landingBuild.test.ts prövar ordningen i dist.
import type { Plugin } from 'vite';

export const THEME_CHUNK_NAME = 'theme';

const STYLESHEET_LINK = /^\s*<link\b[^>]*\brel="stylesheet"[^>]*>\s*$/;
const THEME_HREF = new RegExp(`/${THEME_CHUNK_NAME}-[\\w-]+\\.css"`);

const POSITION_BY_FILE: Record<string, 'first' | 'last'> = { 'index.html': 'last', 'landing.html': 'first' };

/** Flyttar temats <link> först eller sist bland stilmallslänkarna. Ren funktion, prövad direkt. */
export function placeThemeStylesheet(html: string, position: 'first' | 'last', file: string): string {
  const lines = html.split('\n');
  const themeAt = lines.findIndex((line) => STYLESHEET_LINK.test(line) && THEME_HREF.test(line));
  if (themeAt < 0) throw new Error(`${file}: ingen <link rel="stylesheet"> mot ${THEME_CHUNK_NAME}-*.css (manualChunks i vite.config.ts), kaskadordningen kan inte läggas`);
  const [themeLine] = lines.splice(themeAt, 1);
  const sheetAts = lines.flatMap((line, index) => (STYLESHEET_LINK.test(line) ? [index] : []));
  if (sheetAts.length === 0) return html;
  const insertAt = position === 'first' ? sheetAts[0] : sheetAts[sheetAts.length - 1] + 1;
  lines.splice(insertAt, 0, themeLine);
  return lines.join('\n');
}

export function stylesheetOrder(): Plugin {
  return {
    name: 'rq-stylesheet-order',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const file = ctx.filename.replace(/\\/g, '/').split('/').pop() ?? ctx.filename;
        const position = POSITION_BY_FILE[file];
        return position ? placeThemeStylesheet(html, position, file) : html;
      },
    },
  };
}
