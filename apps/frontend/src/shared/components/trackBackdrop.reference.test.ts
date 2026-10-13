import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss, { type AtRule, type Declaration, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

// Bakgrundsbanans geometri och mått är inte tycke utan fastlagda av designen. Här låses de mot själva designfilerna (Web Prototypen rad 80–103,
// App Prototypen) och mot varandra: banans ovaler i TrackBackdrop.tsx, keyframesen rqTrackLap1–3 i temafilen, löparnas vilopositioner och
// token-värdena. Ändras en av dem utan de andra (eller utan designen) faller testet. Visuell sanning i en webbläsare är mätt separat (Chromium).
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const DESIGN = '../../../../../docs/design/claude-design/';
const webPrototype = read(`${DESIGN}RunQuest Web Prototype.dc.html`);
const appPrototype = read(`${DESIGN}RunQuest App Prototype.dc.html`);
const tsx = read('./TrackBackdrop.tsx');
const themeCss = postcss.parse(read('../../index.css'));

// Prototypens bakgrundsblock: från showTrackBg-villkoret till slutet på banans SVG.
const blockStart = webPrototype.indexOf('<sc-if value="{{ showTrackBg }}"');
const block = webPrototype.slice(blockStart, webPrototype.indexOf('</svg>', blockStart));

const numbers = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].map((match) => Number(match[1]));
const seconds = (value: string | undefined) => Number(value?.replace(/s$/, ''));

// ── Tokens ur temafilen: mobilvärdet (utanför mediefrågan) och desktopvärdet (min-width: 1024px) ──────────────
const base = new Map<string, string>();
const desktop = new Map<string, string>();
themeCss.walkDecls(/^--rq-/, (decl: Declaration) => {
  const parent = decl.parent as Rule;
  const at = parent.parent?.type === 'atrule' ? (parent.parent as AtRule) : undefined;
  if (parent.selector !== ':root') return;
  const value = decl.value.replace(/\s+/g, ' ').trim();
  if (!at) base.set(decl.prop, value);
  else if (at.params.includes('min-width: 1024px')) desktop.set(decl.prop, value);
});
const token = (name: string) => base.get(name);
const tokenNumber = (name: string) => parseFloat(token(name) ?? 'NaN');
const desktopNumber = (name: string) => parseFloat(desktop.get(name) ?? 'NaN');

// ── Geometri ──────────────────────────────────────────────────────────────────────────────────────────
const lanePaths = [...tsx.matchAll(/path: '([^']+)'/g)].map((match) => match[1]);
const OVAL = /^M(\d+) (\d+) H(\d+) A(\d+) (\d+) 0 0 1 (\d+) (\d+) H(\d+) A(\d+) (\d+) 0 0 1 (\d+) (\d+) Z$/;
function oval(d: string) {
  const m = OVAL.exec(d);
  if (!m) throw new Error(`oväntad ovalform: ${d}`);
  const [x0, yTop, xRight, rx1, ry1, xEnd, yBottom, xLeft, rx2, ry2, xClose, yClose] = m.slice(1).map(Number);
  return { x0, yTop, xRight, rx1, ry1, xEnd, yBottom, xLeft, rx2, ry2, xClose, yClose };
}

/** translate(Xpx, Ypx) rotate(Ddeg) translate(0, -Rpx) */
function parseTransform(value: string) {
  const m = /^translate\((-?[\d.]+)px, (-?[\d.]+)px\) rotate\((-?[\d.]+)deg\) translate\(0, -([\d.]+)px\)$/.exec(value.trim());
  if (!m) throw new Error(`oväntad transform: ${value}`);
  const [x, y, deg, r] = m.slice(1).map(Number);
  return { x, y, deg, r };
}
const pointOf = ({ x, y, deg, r }: ReturnType<typeof parseTransform>) => {
  const rad = (deg * Math.PI) / 180;
  return { x: x + r * Math.sin(rad), y: y - r * Math.cos(rad) };
};

function lapStops(name: string) {
  const stops: { percent: number; transform: ReturnType<typeof parseTransform> }[] = [];
  themeCss.walkAtRules('keyframes', (atRule) => {
    if (atRule.params !== name) return;
    atRule.walkRules((rule) => {
      const value = (rule.nodes ?? []).find((node): node is Declaration => node.type === 'decl' && node.prop === 'transform')?.value ?? '';
      stops.push({ percent: parseFloat(rule.selector), transform: parseTransform(value) });
    });
  });
  return stops.sort((a, b) => a.percent - b.percent);
}

describe('bakgrundsbanan — geometri', () => {
  it('de fyra ovalerna i komponenten är prototypens, tecken för tecken', () => {
    const prototypePaths = [...block.matchAll(/<path[^>]* d="([^"]+)"/g)].map((match) => match[1]);
    expect(prototypePaths).toHaveLength(4);
    expect(lanePaths).toEqual(prototypePaths);
  });

  it('viewBox, mållinje och rutans mått i komponenten och temafilen är prototypens', () => {
    expect(/const VIEWBOX = '([^']+)'/.exec(tsx)?.[1]).toBe(/viewBox="([^"]+)"/.exec(block)?.[1]);
    const finish = /const FINISH = \{ x: (\d+), y1: (\d+), y2: (\d+) \}/.exec(tsx)?.slice(1).map(Number);
    const prototypeFinish = /<line x1="(\d+)" y1="(\d+)" x2="\d+" y2="(\d+)"/.exec(block)?.slice(1).map(Number);
    expect(finish).toEqual(prototypeFinish);
    expect([tokenNumber('--rq-track-bg-vb-w'), tokenNumber('--rq-track-bg-vb-h')]).toEqual('0 0 1400 760'.split(' ').slice(2).map(Number));
    expect(`0 0 ${tokenNumber('--rq-track-bg-vb-w')} ${tokenNumber('--rq-track-bg-vb-h')}`).toBe(/viewBox="([^"]+)"/.exec(block)?.[1]);
  });

  it('ovalerna är raka stycken 340→1060 med mittlinjen y = 380 och radierna 150 / 184 / 218 / 252', () => {
    const ovals = lanePaths.map(oval);
    expect(ovals.map((o) => [o.x0, o.xRight, o.xLeft, o.xEnd, o.xClose])).toEqual(Array(4).fill([340, 1060, 340, 1060, 340]));
    expect(ovals.map((o) => (o.yTop + o.yBottom) / 2)).toEqual([380, 380, 380, 380]);
    expect(ovals.map((o) => (o.yBottom - o.yTop) / 2)).toEqual([150, 184, 218, 252]);
    for (const o of ovals) {
      expect([o.rx1, o.ry1, o.rx2, o.ry2]).toEqual(Array(4).fill((o.yBottom - o.yTop) / 2));
      expect(o.yClose).toBe(o.yTop);
    }
  });

  it.each([1, 2, 3])('keyframes rqTrackLap%i följer samma oval som banan: samma raka stycke, mittlinje och radie, rakt–halvcirkel–rakt–halvcirkel', (lane) => {
    const { yTop, yBottom } = oval(lanePaths[lane - 1]);
    const radius = (yBottom - yTop) / 2;
    const centre = (yTop + yBottom) / 2;
    const stops = lapStops(`rqTrackLap${lane}`);
    expect(stops).toHaveLength(5);
    expect(stops.map((s) => s.percent)[0]).toBe(0);
    expect(stops.map((s) => s.percent)[2]).toBe(50);
    expect(stops.map((s) => s.percent)[4]).toBe(100);
    // x och vinkel per stopp: start uppe till vänster, uppe till höger, rakt höger (halvcirkel klar), nere till vänster, rundad tillbaka.
    expect(stops.map((s) => [s.transform.x, s.transform.deg])).toEqual([[340, 0], [1060, 0], [1060, 180], [340, 180], [340, 360]]);
    for (const { transform } of stops) {
      expect(transform.y).toBe(centre);
      expect(transform.r).toBe(radius);
    }
    // Och punkterna ligger på ovalens kanter: uppe vid yTop, nere vid yBottom.
    expect(stops.map((s) => Math.round(pointOf(s.transform).y * 100) / 100)).toEqual([yTop, yTop, yBottom, yBottom, yTop]);
  });
});

describe('bakgrundsbanan — mått och tider är prototypens', () => {
  it('rutnätet: 40 px mellan linjerna, ett varv (fyra rutor) på 9 s, alfa .035 på desktop och .03 på mobil', () => {
    const web = /linear-gradient\(rgba\(255,215,0,(\.\d+)\) 1px, transparent 1px\); background-size:100% (\d+)px; animation:rqGrid (\d+)s/.exec(block);
    const app = /linear-gradient\(rgba\(255,215,0,(\.\d+)\) 1px, transparent 1px\); background-size:100% (\d+)px; animation:rqGrid (\d+)s/.exec(appPrototype);
    expect(web && app).toBeTruthy();
    expect(tokenNumber('--rq-track-bg-grid-step')).toBe(Number(web?.[2]));
    expect(tokenNumber('--rq-track-bg-grid-step')).toBe(Number(app?.[2]));
    expect(token('--rq-track-bg-grid-step')).toBe('40px');
    expect(seconds(token('--rq-track-bg-grid-dur'))).toBe(Number(web?.[3]));
    expect(token('--rq-track-bg-grid-dur')).toBe('9s');
    expect(desktopNumber('--rq-track-bg-grid-alpha')).toBe(Number(web?.[1]));
    expect(tokenNumber('--rq-track-bg-grid-alpha')).toBe(Number(app?.[1]));
  });

  it('rutnätet glider exakt fyra rutor per varv: keyframen och lagrets förlängning följer steget (160 px = rqGrid)', () => {
    let drift = '';
    themeCss.walkAtRules('keyframes', (atRule) => {
      if (atRule.params !== 'rqTrackDrift') return;
      atRule.walkDecls('transform', (decl) => {
        drift = decl.value;
      });
    });
    expect(drift).toBe('translateY(calc(var(--rq-track-bg-grid-step) * -4))');
    expect(read('./track-backdrop.css')).toContain('bottom: calc(var(--rq-track-bg-grid-step) * -4)');
    expect(tokenNumber('--rq-track-bg-grid-step') * 4).toBe(Number(/@keyframes rqGrid \{ from \{ background-position:0 0; \} to \{ background-position:0 (-\d+)px/.exec(webPrototype)?.[1]) * -1);
  });

  it('banan på desktop: 820 px bred, right −190, bottom −206 (prototypens −210 plus de 4 px som dess inline-SVG:s radavstånd lägger under banan), opacity .5', () => {
    const track = /right:(-?\d+)px; bottom:(-?\d+)px; width:(\d+)px;[^"]*opacity:(\.\d+)/.exec(block);
    expect(track).toBeTruthy();
    const [right, bottom, width, opacity] = track!.slice(1).map(Number);
    expect([right, bottom, width, opacity]).toEqual([-190, -210, 820, 0.5]);
    expect(desktopNumber('--rq-track-bg-right')).toBe(right);
    expect(desktopNumber('--rq-track-bg-bottom')).toBe(bottom + 4);
    expect(desktopNumber('--rq-track-bg-bottom')).toBe(-206);
    expect(Math.round(tokenNumber('--rq-track-bg-vb-w') * desktopNumber('--rq-track-bg-scale'))).toBe(width);
    expect(tokenNumber('--rq-track-bg-opacity')).toBe(opacity);
  });

  it('mobilens bana är den skalade versionen (480 px bred; prototypen har ingen liten bana) med samma hörn-förankring', () => {
    expect(Math.round(tokenNumber('--rq-track-bg-vb-w') * tokenNumber('--rq-track-bg-scale'))).toBe(480);
    expect(base.has('--rq-track-bg-right') && base.has('--rq-track-bg-bottom')).toBe(true);
  });

  it('masken är prototypens radialgradient, och sidnavet är 250 px (där bakgrunden börjar på desktop)', () => {
    const mask = /mask-image:(radial-gradient\([^;]+\));/.exec(block)?.[1].replace(/\s+/g, ' ');
    expect(mask).toBe('radial-gradient(ellipse at 55% 45%, #000 40%, transparent 76%)');
    expect(token('--rq-track-bg-mask')).toBe(mask);
    expect(Number(/grid-template-columns:(\d+)px 1fr; width:max\(100vw/.exec(webPrototype)?.[1])).toBe(250);
    expect(tokenNumber('--rq-sidebar-w')).toBe(250);
  });

  it('banlinjer, mållinje och prickar: alfa per bana .13 / .10 / .08 / .06, mållinje .16, prickar guld .42 · silver .26 · brons .3 med radie 8 / 7 / 6,5', () => {
    const strokes = numbers(block, /stroke="rgba\(255,215,0,(\.\d+)\)"/g);
    expect(strokes).toEqual([0.13, 0.1, 0.08, 0.06, 0.16]);
    expect([1, 2, 3, 4].map((n) => tokenNumber(`--rq-track-bg-lane-alpha-${n}`))).toEqual(strokes.slice(0, 4));
    expect(tokenNumber('--rq-track-bg-finish-alpha')).toBe(strokes[4]);
    expect(numbers(block, /stroke-width="([\d.]+)"/g)).toEqual([2.4, 2.5]);
    expect([tokenNumber('--rq-track-bg-lane-w'), tokenNumber('--rq-track-bg-finish-w')]).toEqual([2.4, 2.5]);

    const dots = [...block.matchAll(/<circle r="([\d.]+)" fill="rgba\((\d+),(\d+),(\d+),(\.\d+)\)"/g)].map((m) => ({ r: Number(m[1]), rgb: m.slice(2, 5).join(','), alpha: Number(m[5]) }));
    expect(dots.map((d) => d.r)).toEqual([8, 7, 6.5]);
    expect(dots.map((d) => d.alpha)).toEqual([0.42, 0.26, 0.3]);
    expect(dots.map((d) => d.rgb)[0]).toBe('255,215,0');
    expect([1, 2, 3].map((n) => tokenNumber(`--rq-track-bg-dot-alpha-${n}`))).toEqual(dots.map((d) => d.alpha));
    expect([1, 2, 3].map((n) => tokenNumber(`--rq-track-bg-dot-d-${n}`))).toEqual(dots.map((d) => d.r * 2));
  });

  it('varvtiderna 24 / 31 / 39 s och startförskjutningarna −8 / −19 s', () => {
    const durations = numbers(block, /dur="(\d+)s"/g);
    const begins = numbers(block, /begin="(-\d+)s"/g);
    expect(durations).toEqual([24, 31, 39]);
    expect(begins).toEqual([-8, -19]);
    expect([1, 2, 3].map((n) => seconds(token(`--rq-track-bg-lap-${n}`)))).toEqual(durations);
    expect([2, 3].map((n) => seconds(token(`--rq-track-bg-lap-offset-${n}`)))).toEqual(begins);
  });
});

describe('bakgrundsbanan — vilopositioner', () => {
  it.each([1, 2, 3])('--rq-track-bg-rest-%i är löparens position vid sin startfas (fördröjning ÷ varvtid: 0, 8/31, 19/39) längs sin oval', (lane) => {
    const lap = seconds(token(`--rq-track-bg-lap-${lane}`));
    const delay = lane === 1 ? 0 : Math.abs(seconds(token(`--rq-track-bg-lap-offset-${lane}`)));
    const phase = delay / lap;

    // Var löparen står vid den fasen: rakt stycke 720, halvcirkel π·r, rakt stycke, halvcirkel — samma fart överallt.
    const { yTop, yBottom } = oval(lanePaths[lane - 1]);
    const r = (yBottom - yTop) / 2;
    const centre = (yTop + yBottom) / 2;
    const straight = 720;
    const half = Math.PI * r;
    let s = phase * (2 * straight + 2 * half);
    let expected: { x: number; y: number };
    if (s <= straight) expected = { x: 340 + s, y: yTop };
    else if (((s -= straight), s <= half)) expected = { x: 1060 + r * Math.sin(s / r), y: centre - r * Math.cos(s / r) };
    else if (((s -= half), s <= straight)) expected = { x: 1060 - s, y: yBottom };
    else expected = { x: 340 - r * Math.sin((s - straight) / r), y: centre + r * Math.cos((s - straight) / r) };

    const rest = pointOf(parseTransform(token(`--rq-track-bg-rest-${lane}`) ?? ''));
    expect(Math.abs(rest.x - expected.x)).toBeLessThan(0.1);
    expect(Math.abs(rest.y - expected.y)).toBeLessThan(0.1);
  });
});
