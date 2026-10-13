import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import stylelint from 'stylelint';

// Stravas regler för loggan i footern vaktas av Stylelint-regeln rq/strava-logo (stylelint.config.js). Här prövas regeln med prov som SKA fällas
// och prov som SKA gå igenom, mot den riktiga konfigurationen och filnamnet landing.css (så att rätt override gäller).

// Sökvägen i variabel: Vite skriver annars om en bokstavlig new URL('./…', import.meta.url).
const FRONTEND_DIR = '../../../';
const frontendDir = fileURLToPath(new URL(FRONTEND_DIR, import.meta.url));
const config = ((await import(/* @vite-ignore */ new URL('stylelint.config.js', new URL(FRONTEND_DIR, import.meta.url)).href)) as { default: stylelint.Config }).default;

async function lintLanding(css: string): Promise<string[]> {
  const { results } = await stylelint.lint({ code: css, codeFilename: `${frontendDir}src/features/landing/landing.css`, config });
  return results.flatMap((result) => result.warnings.filter((warning) => warning.rule === 'rq/strava-logo').map((warning) => warning.text));
}

describe('Stravas logga i footern (Stylelint: rq/strava-logo)', () => {
  it('den riktiga stilen går igenom: block, höjd 1em och bredd auto', async () => {
    expect(await lintLanding('.rq-landing-footer__strava { display: block; height: 1em; width: auto; }')).toEqual([]);
  });

  it.each([
    ['filter', '.rq-landing-footer__strava { filter: grayscale(1); }'],
    ['opacity', '.rq-landing-footer__strava { opacity: .5; }'],
    ['transform', '.rq-landing-footer__strava { transform: scale(2); }'],
    ['animation', '.rq-landing-footer__strava { animation: rqBlink 1s linear infinite; }'],
    ['transition', '.rq-landing-footer__strava { transition: opacity .2s; }'],
    ['mix-blend-mode', '.rq-landing-footer__strava { mix-blend-mode: multiply; }'],
    ['hover', '.rq-landing-footer__strava:hover { height: 1em; }'],
    ['hover via förälder', '.rq-landing-footer a:hover .rq-landing-footer__strava { height: 1em; }'],
    ['fokus', '.rq-landing-footer__strava:focus-visible { height: 1em; }'],
    ['för hög', '.rq-landing-footer__strava { height: 2em; }'],
    ['höjd i rem', '.rq-landing-footer__strava { height: 1rem; }'],
    ['höjd som token', '.rq-landing-footer__strava { height: var(--rq-landing-track-h); }'],
    ['maxhöjd för hög', '.rq-landing-footer__strava { max-height: 3em; }'],
    ['fast bredd', '.rq-landing-footer__strava { width: 100%; }'],
    ['en annan img i footern', '.rq-landing-footer .rq-landing-footer__aside img { filter: invert(1); }'],
  ])('fäller %s', async (_name, css) => {
    expect((await lintLanding(css)).length).toBeGreaterThan(0);
  });

  it('rör inte andra element i footern', async () => {
    expect(await lintLanding('.rq-landing-footer__links a:hover { color: var(--rq-gold-text); } .rq-landing-footer { opacity: 1; }')).toEqual([]);
  });
});
