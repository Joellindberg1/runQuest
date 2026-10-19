import { describe, expect, it } from 'vitest';
import { placeThemeStylesheet } from '../../stylesheetOrder';

// Temats <link> flyttas först eller sist bland stilmallslänkarna (kaskadordningen per HTML-ingång, se stylesheetOrder.ts). Provet av själva byggets
// länkordning står i landingBuild.test.ts; här prövas flyttningen och felet när temat saknas.
const head = (...sheets: string[]) =>
  ['<head>', '    <script type="module" crossorigin src="/assets/main.js"></script>', '    <link rel="modulepreload" crossorigin href="/assets/router.js">', ...sheets.map((href) => `    <link rel="stylesheet" crossorigin href="/assets/${href}">`), '  </head>'].join('\n');

describe('placeThemeStylesheet', () => {
  const sheets = ['theme-AbC123.css', 'app-shell-X.css', 'index-Y.css'];

  it('puts the theme last, after the vendor and feature sheets', () => {
    expect(placeThemeStylesheet(head(...sheets), 'last', 'index.html')).toBe(head('app-shell-X.css', 'index-Y.css', 'theme-AbC123.css'));
  });

  it('puts the theme first, before the other sheets', () => {
    expect(placeThemeStylesheet(head('safeNext-Z.css', 'theme-AbC123.css'), 'first', 'landing.html')).toBe(head('theme-AbC123.css', 'safeNext-Z.css'));
  });

  it('leaves everything else in the head where it was, and keeps CRLF line endings', () => {
    const crlf = head(...sheets).replace(/\n/g, '\r\n');
    const result = placeThemeStylesheet(crlf, 'last', 'index.html');
    expect(result.split('\r\n')[2]).toContain('modulepreload');
    expect(result.split('\r\n').filter((line) => line.includes('rel="stylesheet"')).map((line) => /assets\/([^"]+)"/.exec(line)![1])).toEqual(['app-shell-X.css', 'index-Y.css', 'theme-AbC123.css']);
  });

  it('fails the build when the theme sheet is not linked, so a renamed chunk cannot silently restore the wrong order', () => {
    expect(() => placeThemeStylesheet(head('app-shell-X.css', 'index-Y.css'), 'last', 'index.html')).toThrow(/index\.html.*theme-\*\.css/);
  });

  it('does not mistake another sheet whose name merely contains "theme"', () => {
    expect(() => placeThemeStylesheet(head('themeDemo-Q.css'), 'last', 'index.html')).toThrow();
  });
});
