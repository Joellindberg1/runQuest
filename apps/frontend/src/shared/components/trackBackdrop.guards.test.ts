import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss, { type AtRule, type Declaration, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

// Lagerordningen och rörelsen i bakgrundsbanan går inte att pröva i jsdom (ingen layout, inga mediefrågor), så reglerna som gör dem sanna
// vaktas här i CSS:en; sanningen i en riktig webbläsare (elementFromPoint, emulerad reducerad rörelse) är mätt i Chromium.
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const backdropCss = postcss.parse(read('./track-backdrop.css'));
const shellCss = postcss.parse(read('../../app-shell/app-shell.css'));
const legalCss = postcss.parse(read('../../features/legal/legal.css'));
const themeCss = postcss.parse(read('../../index.css'));

const declarations = (rule: Rule) => (rule.nodes ?? []).filter((node): node is Declaration => node.type === 'decl');
const isReducedMotion = (rule: Rule) => rule.parent?.type === 'atrule' && (rule.parent as AtRule).params.includes('prefers-reduced-motion: reduce');
const isInsideMedia = (rule: Rule) => rule.parent?.type === 'atrule' && (rule.parent as AtRule).name === 'media';

/** Värdet en vanlig (ej mediefråge-) regel sätter på en egenskap. */
function valueOf(css: postcss.Root, selector: string, prop: string): string | undefined {
  let found: string | undefined;
  css.walkRules((rule) => {
    if (isInsideMedia(rule) || !rule.selectors.includes(selector)) return;
    for (const decl of declarations(rule)) if (decl.prop === prop) found = decl.value;
  });
  return found;
}

describe('bakgrundsbanan — lager', () => {
  it('ligger som ett fast lager som aldrig tar emot pekare och aldrig har ett eget z-index', () => {
    expect(valueOf(backdropCss, '.rq-track-bg', 'position')).toBe('fixed');
    expect(valueOf(backdropCss, '.rq-track-bg', 'pointer-events')).toBe('none');
    const zIndexed: string[] = [];
    backdropCss.walkDecls('z-index', (decl) => {
      zIndexed.push(decl.parent && 'selector' in decl.parent ? String(decl.parent.selector) : '');
    });
    expect(zIndexed).toEqual([]);
  });

  it('innehållet ritas ovanpå: skalets sida och legal-ramen är positionerade och kommer efter bakgrunden i trädet', () => {
    // Ett positionerat element utan z-index ritas i trädordning, och en icke-positionerad sida ritas UNDER det: därför position: relative.
    expect(valueOf(shellCss, '.rq-shell__main', 'position')).toBe('relative');
    expect(valueOf(legalCss, '.rq-legal__inner', 'position')).toBe('relative');
  });
});

describe('bakgrundsbanan — rörelse', () => {
  it('varje animation (rutnätet och löparna) stängs av med animation: none under prefers-reduced-motion: reduce', () => {
    const animated: string[] = [];
    const stopped = new Set<string>();
    backdropCss.walkRules((rule) => {
      const sets = (value: (v: string) => boolean) => declarations(rule).some((decl) => decl.prop === 'animation' && value(decl.value));
      if (!isReducedMotion(rule) && sets((v) => v !== 'none')) animated.push(...rule.selectors);
      if (isReducedMotion(rule) && sets((v) => v === 'none')) rule.selectors.forEach((selector) => stopped.add(selector));
    });

    expect(animated.length).toBeGreaterThanOrEqual(4); // rutnätet + tre löpare; noll vore en tyst godkänd parsning
    expect(animated.filter((selector) => !stopped.has(selector))).toEqual([]);
  });

  it('löparna har spridda vilopositioner så att stillastående bana visar en ögonblicksbild, inte en klump', () => {
    const restOf = (rule: Rule) => declarations(rule).find((decl) => decl.prop === 'transform')?.value;
    const used: string[] = [];
    backdropCss.walkRules((rule) => {
      if (isReducedMotion(rule) || !/\[data-runner="\d"\]/.test(rule.selector)) return;
      used.push(restOf(rule) ?? '');
    });
    expect(used).toEqual(['var(--rq-track-bg-rest-1)', 'var(--rq-track-bg-rest-2)', 'var(--rq-track-bg-rest-3)']);

    const declared = new Map<string, string>();
    themeCss.walkDecls(/^--rq-track-bg-rest-\d$/, (decl) => {
      declared.set(decl.prop, decl.value);
    });
    expect(declared.size).toBe(3);
    expect(new Set(declared.values()).size).toBe(3);
  });

  it('löparna håller samma fart längs hela ovalen: keyframe-stegen är proportionella mot bandelarnas längd (rakt 720, halvcirkel π·r)', () => {
    const STRAIGHT = 720;
    const checked: string[] = [];
    themeCss.walkAtRules('keyframes', (atRule) => {
      if (!/^rqTrackLap[1-3]$/.test(atRule.params)) return;
      const stops = new Map<number, string>();
      atRule.walkRules((rule) => {
        stops.set(parseFloat(rule.selector), declarations(rule).find((decl) => decl.prop === 'transform')?.value ?? '');
      });
      const percents = [...stops.keys()].sort((a, b) => a - b);
      const radius = Number(/translate\(0, -(\d+)px\)/.exec(stops.get(0) ?? '')?.[1]);
      const length = 2 * STRAIGHT + 2 * Math.PI * radius;
      const parts = percents.slice(1).map((percent, i) => ((percent - percents[i]) / 100) * length);
      const arc = Math.PI * radius;
      expect(percents).toHaveLength(5);
      parts.forEach((part, i) => expect(Math.abs(part - (i % 2 === 0 ? STRAIGHT : arc))).toBeLessThan(0.5));
      checked.push(atRule.params);
    });
    expect(checked).toHaveLength(3);
  });

  it('bara transform animeras: keyframesen som bakgrunden använder rör inget annat (inget som ger layout eller ommålning varje bildruta)', () => {
    const animatedProps = new Map<string, Set<string>>();
    themeCss.walkAtRules('keyframes', (atRule) => {
      if (!/^rqTrack(?:Drift|Lap[1-3])$/.test(atRule.params)) return;
      const props = new Set<string>();
      atRule.walkDecls((decl) => {
        props.add(decl.prop);
      });
      animatedProps.set(atRule.params, props);
    });
    expect([...animatedProps.keys()].sort()).toEqual(['rqTrackDrift', 'rqTrackLap1', 'rqTrackLap2', 'rqTrackLap3']);
    for (const props of animatedProps.values()) expect([...props]).toEqual(['transform']);
  });
});
