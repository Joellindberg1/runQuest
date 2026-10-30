import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/test';
import { contrastOf } from '../support/contrast';
import { dismissOverlays } from '../support/overlays';
import { stubSendSheetApi, type SendSheetScenario } from '../support/sendSheetStub';
import { apiIsStubbed } from '../support/stubApi';
import { waitForStylesApplied } from '../support/stylesApplied';

/** Minsta träffyta på mobil (samma värde som --rq-control-hit). */
const MIN_HIT_PX = 44;
/** Minsta träffyta för muspekare (WCAG 2.5.8). */
const MIN_POINTER_PX = 24;
/** Minsta kontrast för text mot sin bakgrund (WCAG AA, normal text). */
const MIN_TEXT_CONTRAST = 4.5;
/** Några tiondels pixlar marginal för subpixelavrundning. */
const ROUNDING_PX = 0.5;
/** Hemindikatorn på en iPhone med notch, som `env(safe-area-inset-bottom)`. */
const HOME_INDICATOR_PX = 34;

const THEMES = ['dark', 'light'] as const;
type Theme = (typeof THEMES)[number];
const DESKTOP_SCREENS = [{ width: 1280, height: 768 }, { width: 1440, height: 900 }];
const PHONE_SCREENS = [{ width: 375, height: 667 }, { width: 390, height: 844 }, { width: 320, height: 568 }];
const MEMBER_COUNTS = [7, 12];

const STEP_HEADINGS = [/^1 · Pick a tier/, /^2 · Pick a challenge/, /^3 · Pick an opponent/, /^The bet$/];

interface Box { top: number; bottom: number; left: number; right: number; height: number; width: number }

interface SheetMeasure {
  viewport: { width: number; height: number };
  /** Hur mycket sidan har att scrolla (dokumentet, inte arket). */
  pageScrollY: number;
  pageScrollX: number;
  sheet: Box;
  head: Box;
  body: Box & { scrollHeight: number; clientHeight: number; scrollTop: number };
  foot: Box;
  bet: Box;
  send: Box;
  cancel: Box;
}

/** Körs i sidan: de tre cellerna i "The bet" (If you win, If you lose, Starts) och raden de ligger i. */
function measureStakeCells(): { row: Box; cells: Box[] } {
  const box = (node: Element): Box => {
    const rect = node.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height, width: rect.width };
  };
  const row = document.querySelector('.rq-duels-bet__stakes');
  if (!row) throw new Error('missing the stakes row');
  return { row: box(row), cells: Array.from(row.children).map(box) };
}

/** Körs i sidan: arkets delar, knapparna och hur mycket sidan under kan scrolla. */
function measureSheet(): SheetMeasure {
  const box = (node: Element): Box => {
    const rect = node.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height, width: rect.width };
  };
  const pick = <T extends Element>(selector: string, root: ParentNode = document): T => {
    const found = root.querySelector<T>(selector);
    if (!found) throw new Error(`missing ${selector}`);
    return found;
  };
  const sheet = pick('.rq-duels-sheet');
  const body = pick<HTMLElement>('.rq-duels-sheet__body', sheet);
  const foot = pick('.rq-duels-sheet__foot', sheet);
  const buttons = Array.from(foot.querySelectorAll('button'));
  const named = (text: RegExp) => {
    const found = buttons.find((button) => text.test(button.textContent ?? ''));
    if (!found) throw new Error(`missing button ${text}`);
    return box(found);
  };
  const page = document.scrollingElement ?? document.documentElement;
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    pageScrollY: page.scrollHeight - page.clientHeight,
    pageScrollX: page.scrollWidth - page.clientWidth,
    sheet: box(sheet),
    head: box(pick('header', sheet)),
    body: { ...box(body), scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, scrollTop: body.scrollTop },
    foot: box(foot),
    bet: box(pick('.rq-duels-bet', sheet)),
    send: named(/^Send|^Sending/),
    cancel: named(/^Cancel/),
  };
}

async function openSheetFromCard(page: Page, theme: Theme, width: number, height: number, members: number, scenario: SendSheetScenario = 'ready'): Promise<Locator> {
  await page.addInitScript((value) => window.localStorage.setItem('theme', value), theme);
  await stubSendSheetApi(page, { members, scenario });
  await page.setViewportSize({ width, height });
  await page.goto('/duels');
  await dismissOverlays(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.getByRole('region', { name: 'Your tokens' }).getByRole('button', { name: /^Send a minor challenge/ }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Send a challenge' });
  await expect(sheet.getByRole('region', { name: 'The bet' })).toBeVisible();
  await waitForStylesApplied(page);
  return sheet;
}

async function openSheetFromHeader(page: Page, theme: Theme, width: number, height: number, scenario: SendSheetScenario): Promise<{ sheet: Locator; opener: Locator }> {
  await page.addInitScript((value) => window.localStorage.setItem('theme', value), theme);
  await stubSendSheetApi(page, { members: 7, scenario });
  await page.setViewportSize({ width, height });
  await page.goto('/duels');
  await dismissOverlays(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  const opener = page.locator('[data-tour="duels-send"]');
  await opener.click();
  const sheet = page.getByRole('dialog', { name: 'Send a challenge' });
  await expect(sheet).toBeVisible();
  await waitForStylesApplied(page);
  return { sheet, opener };
}

test.describe('the send-a-challenge sheet: fixed head and button row', () => {
  test.skip(!apiIsStubbed(), 'The sheet is filled from a stubbed challenges API; run with E2E_STUB_API=1 against a local build.');

  for (const { width, height } of DESKTOP_SCREENS) {
    for (const members of MEMBER_COUNTS) {
      for (const theme of THEMES) {
        test(`on ${width}×${height} with ${members} members the head and the buttons stay in view, the page does not scroll, and The bet is reached by scrolling the middle (${theme} theme)`, async ({ page }) => {
          const sheet = await openSheetFromCard(page, theme, width, height, members);
          const before = await page.evaluate(measureSheet);
          const where = `${width}×${height} / ${members} members / ${theme}`;
          test.info().annotations.push({ type: 'measure', description: `${where}: ${JSON.stringify(before)}` });

          expect(before.pageScrollY, `${where}: the page has nothing to scroll`).toBeLessThanOrEqual(0);
          expect(before.pageScrollX, `${where}: the page does not scroll sideways`).toBeLessThanOrEqual(0);
          expect(before.sheet.top, `${where}: the sheet starts inside the screen`).toBeGreaterThanOrEqual(0);
          expect(before.sheet.bottom, `${where}: the sheet ends inside the screen`).toBeLessThanOrEqual(before.viewport.height);
          expect(before.foot.bottom, `${where}: the button row is in view`).toBeLessThanOrEqual(before.viewport.height);
          expect(before.body.scrollHeight, `${where}: the middle has more to show than fits, so it scrolls`).toBeGreaterThan(before.body.clientHeight);
          expect(Math.abs(before.send.top - before.cancel.top), `${where}: Send and Cancel share a row`).toBeLessThanOrEqual(1);

          // Hjulet över mitten scrollar mitten, inte sidan, och huvudet och knapparna ligger kvar där de låg.
          await page.mouse.move((before.body.left + before.body.right) / 2, (before.body.top + before.body.bottom) / 2);
          await page.mouse.wheel(0, 5000);
          await expect.poll(async () => (await page.evaluate(measureSheet)).body.scrollTop, { message: `${where}: the wheel scrolls the middle` }).toBeGreaterThan(0);
          const after = await page.evaluate(measureSheet);
          expect(after.pageScrollY, `${where}: the page still has nothing to scroll`).toBeLessThanOrEqual(0);
          expect(after.head.top, `${where}: the head did not move`).toBeCloseTo(before.head.top, 0);
          expect(after.foot.top, `${where}: the button row did not move`).toBeCloseTo(before.foot.top, 0);
          expect(after.bet.top, `${where}: The bet is inside the middle`).toBeGreaterThanOrEqual(after.body.top - ROUNDING_PX);
          expect(after.bet.bottom, `${where}: The bet ends above the button row`).toBeLessThanOrEqual(after.foot.top + ROUNDING_PX);

          // På desktop är "The bet" tre kolumner på samma rad.
          const stakes = await page.evaluate(measureStakeCells);
          expect(stakes.cells, `${where}: three cells`).toHaveLength(3);
          for (const cell of stakes.cells) expect(Math.abs(cell.top - (stakes.cells[0]?.top ?? 0)), `${where}: win, lose and Starts share one row`).toBeLessThanOrEqual(1);

          // Stängknappen ✕ är en tillräckligt stor träffyta också för muspekaren (WCAG 2.5.8).
          const cross = await sheet.getByRole('button', { name: 'Close' }).boundingBox();
          expect(cross?.width ?? 0, `${where}: the close cross is at least ${MIN_POINTER_PX} px wide`).toBeGreaterThanOrEqual(MIN_POINTER_PX - ROUNDING_PX);
          expect(cross?.height ?? 0, `${where}: the close cross is at least ${MIN_POINTER_PX} px tall`).toBeGreaterThanOrEqual(MIN_POINTER_PX - ROUNDING_PX);

          // Knapparna går att trycka på: ingenting ligger ovanpå dem.
          await sheet.getByRole('button', { name: 'Cancel' }).click({ trial: true });
          await expect(sheet.getByRole('button', { name: 'Send challenge' })).toBeVisible();
        });
      }
    }
  }
});

test.describe('the send-a-challenge sheet on a phone', () => {
  test.skip(!apiIsStubbed(), 'The sheet is filled from a stubbed challenges API; run with E2E_STUB_API=1 against a local build.');

  for (const { width, height } of PHONE_SCREENS) {
    for (const theme of THEMES) {
      test(`at ${width}×${height} Send and Cancel share one row above the home indicator, no step heading hides behind it, and Starts fits its column on every tier (${theme} theme)`, async ({ page }) => {
        const sheet = await openSheetFromCard(page, theme, width, height, 12);
        const where = `${width}×${height} / ${theme}`;
        const measured = await page.evaluate(measureSheet);
        test.info().annotations.push({ type: 'measure', description: `${where}: ${JSON.stringify(measured)}` });

        // SEND och Cancel på en rad (som skiss S3), båda minst 44 px höga, och raden ligger i bild.
        expect(Math.abs(measured.send.top - measured.cancel.top), `${where}: Send and Cancel share a row`).toBeLessThanOrEqual(1);
        expect(measured.cancel.left, `${where}: Cancel is to the right of Send`).toBeGreaterThanOrEqual(measured.send.right);
        expect(measured.send.height, `${where}: Send is at least ${MIN_HIT_PX} px tall`).toBeGreaterThanOrEqual(MIN_HIT_PX - ROUNDING_PX);
        expect(measured.cancel.height, `${where}: Cancel is at least ${MIN_HIT_PX} px tall`).toBeGreaterThanOrEqual(MIN_HIT_PX - ROUNDING_PX);
        expect(measured.send.bottom, `${where}: Send is in view`).toBeLessThanOrEqual(measured.viewport.height);
        expect(measured.cancel.right, `${where}: Cancel is in view`).toBeLessThanOrEqual(measured.viewport.width);
        expect(measured.sheet.bottom, `${where}: the sheet sits on the bottom edge`).toBeCloseTo(measured.viewport.height, 0);
        // Stängknappen ✕ i huvudet är en tumknapp som de andra: minst 44 px i båda riktningarna.
        const cross = await sheet.getByRole('button', { name: 'Close' }).boundingBox();
        expect(cross?.width ?? 0, `${where}: the close cross is at least ${MIN_HIT_PX} px wide`).toBeGreaterThanOrEqual(MIN_HIT_PX - ROUNDING_PX);
        expect(cross?.height ?? 0, `${where}: the close cross is at least ${MIN_HIT_PX} px tall`).toBeGreaterThanOrEqual(MIN_HIT_PX - ROUNDING_PX);
        // En tätare knapprad lämnar mer åt mitten: raden är en knapp hög plus luft, aldrig två staplade.
        expect(measured.foot.height, `${where}: the button row is one button high`).toBeLessThan(measured.send.height * 2);
        await sheet.getByRole('button', { name: 'Send challenge' }).click({ trial: true, force: true });

        // Stegrubrikerna och sista motståndaren hamnar aldrig under knappraden, hur de än scrollas i bild (tangentbordsfokus gör samma sak som scrollIntoView).
        const reveal = async (target: Locator, block: 'start' | 'center' | 'end' | 'nearest') => {
          await target.evaluate((node, edge) => node.scrollIntoView({ block: edge }), block);
          return target.evaluate((node) => {
            const rect = node.getBoundingClientRect();
            const body = document.querySelector('.rq-duels-sheet__body')!.getBoundingClientRect();
            const foot = document.querySelector('.rq-duels-sheet__foot')!.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, bodyTop: body.top, footTop: foot.top };
          });
        };
        const targets = [
          ...STEP_HEADINGS.map((name) => ({ label: String(name), locator: sheet.getByRole('heading', { name }) })),
          { label: 'the last opponent', locator: sheet.getByRole('radiogroup', { name: '3 · Pick an opponent' }).getByRole('radio').last() },
        ];
        for (const { label, locator } of targets) {
          for (const block of ['start', 'center', 'end', 'nearest'] as const) {
            const place = await reveal(locator, block);
            expect(place.top, `${where}: ${label} (${block}) starts below the head`).toBeGreaterThanOrEqual(place.bodyTop - ROUNDING_PX);
            expect(place.bottom, `${where}: ${label} (${block}) ends above the button row`).toBeLessThanOrEqual(place.footTop + ROUNDING_PX);
          }
        }
        await sheet.getByRole('radiogroup', { name: '3 · Pick an opponent' }).getByRole('radio').last().focus();
        const focused = await page.evaluate(() => {
          const rect = document.activeElement!.getBoundingClientRect();
          return { bottom: rect.bottom, footTop: document.querySelector('.rq-duels-sheet__foot')!.getBoundingClientRect().top };
        });
        expect(focused.bottom, `${where}: the focused last opponent is above the button row`).toBeLessThanOrEqual(focused.footTop + ROUNDING_PX);

        // Starts: värdet ryms i sin kolumn på alla tre nivåer, också Legendary med sin längre regel.
        for (const label of ['Minor ×3', 'Major ×1', 'Legendary ×1']) {
          await sheet.getByRole('button', { name: label }).click();
          const columns = await page.evaluate(() =>
            Array.from(document.querySelectorAll('.rq-duels-bet__stakes > div')).map((column) => {
              const value = column.querySelector('dd')!;
              const range = document.createRange();
              range.selectNodeContents(value);
              return { term: column.querySelector('dt')!.textContent ?? '', textRight: range.getBoundingClientRect().right, columnRight: column.getBoundingClientRect().right, scroll: value.scrollWidth - value.clientWidth };
            }));
          for (const column of columns) {
            expect(column.textRight, `${where} / ${label}: the value under "${column.term}" stays inside its column`).toBeLessThanOrEqual(column.columnRight + ROUNDING_PX);
            expect(column.scroll, `${where} / ${label}: the value under "${column.term}" does not overflow`).toBeLessThanOrEqual(0);
          }

          // På en telefon står Starts på en egen rad under vinst och förlust, över hela radens bredd.
          const { row, cells } = await page.evaluate(measureStakeCells);
          const [win, lose, starts] = cells;
          expect(cells, `${where} / ${label}: three cells`).toHaveLength(3);
          expect(Math.abs((win?.top ?? 0) - (lose?.top ?? 1)), `${where} / ${label}: win and lose share a row`).toBeLessThanOrEqual(1);
          expect(starts?.top ?? 0, `${where} / ${label}: Starts is on its own row below win and lose`).toBeGreaterThanOrEqual(Math.max(win?.bottom ?? 0, lose?.bottom ?? 0) - ROUNDING_PX);
          expect(starts?.width ?? 0, `${where} / ${label}: Starts spans the whole row`).toBeGreaterThanOrEqual(row.width - ROUNDING_PX);
        }

        // Hemindikatorn: med en safe-area på 34 px ligger Send ovanför den (värdet kommer ur env(safe-area-inset-bottom) via temafilens token).
        const client = await page.context().newCDPSession(page);
        await client.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: HOME_INDICATOR_PX } });
        await waitForStylesApplied(page);
        const lifted = await page.evaluate(measureSheet);
        expect(lifted.viewport.height - lifted.send.bottom, `${where}: Send ends above the home indicator`).toBeGreaterThanOrEqual(HOME_INDICATOR_PX - ROUNDING_PX);
        expect(lifted.viewport.height - lifted.cancel.bottom, `${where}: Cancel ends above the home indicator`).toBeGreaterThanOrEqual(HOME_INDICATOR_PX - ROUNDING_PX);
        expect(Math.abs(lifted.send.top - lifted.cancel.top), `${where}: still one row`).toBeLessThanOrEqual(1);
        await client.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: 0 } });
      });
    }
  }
});

test.describe('the send-a-challenge sheet: empty and blocked states', () => {
  test.skip(!apiIsStubbed(), 'The sheet is filled from a stubbed challenges API; run with E2E_STUB_API=1 against a local build.');

  const STATES: Array<{ scenario: SendSheetScenario; message: RegExp; width: number; height: number }> = [
    { scenario: 'no-tokens', message: /You have no tokens to send/, width: 375, height: 667 },
    { scenario: 'live', message: /You are in a live duel/, width: 1280, height: 768 },
  ];

  for (const { scenario, message, width, height } of STATES) {
    for (const theme of THEMES) {
      test(`${scenario} at ${width} px: the sheet says why with a Close button that is readable and puts the focus back (${theme} theme)`, async ({ page }) => {
        const { sheet, opener } = await openSheetFromHeader(page, theme, width, height, scenario);
        const where = `${scenario} / ${width} px / ${theme}`;
        const reason = sheet.getByRole('status');
        await expect(reason).toHaveText(message);
        const close = sheet.getByRole('button', { name: 'Close', exact: true }).filter({ hasText: 'Close' });
        await expect(close).toBeVisible();
        await expect(sheet.getByRole('button', { name: 'Send challenge' })).toHaveCount(0);

        const measured = await page.evaluate(() => {
          const sheetBox = document.querySelector('.rq-duels-sheet')!.getBoundingClientRect();
          const text = document.querySelector('.rq-duels-sheet__blocked')!.getBoundingClientRect();
          return { sheetHeight: sheetBox.height, sheetBottom: sheetBox.bottom, viewportHeight: window.innerHeight, textHeight: text.height };
        });
        test.info().annotations.push({ type: 'measure', description: `${where}: ${JSON.stringify(measured)}` });
        expect(measured.textHeight, `${where}: there is text, not a blank surface`).toBeGreaterThan(0);
        expect(measured.sheetBottom, `${where}: the sheet is inside the screen`).toBeLessThanOrEqual(measured.viewportHeight);
        const closeBox = await close.boundingBox();
        if (width < 1024) expect(closeBox?.height ?? 0, `${where}: Close is at least ${MIN_HIT_PX} px tall`).toBeGreaterThanOrEqual(MIN_HIT_PX - ROUNDING_PX);

        const samples = await page.evaluate(contrastOf, { selectors: ['.rq-duels-sheet__blocked', '.rq-duels-sheet .rq-btn--ghost'] });
        test.info().annotations.push({ type: 'contrast', description: `${where}: ${JSON.stringify(samples.map((sample) => `${sample.selector.split(' ').pop()} ${sample.ratio}`))}` });
        for (const sample of samples) expect(sample.ratio, `${where}: "${sample.text}" contrast`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);

        await close.click();
        await expect(sheet).toHaveCount(0);
        await expect(opener).toBeFocused();
        expect(new URL(page.url()).pathname).toBe('/duels');
      });
    }
  }
});

test.describe('the send-a-challenge sheet: empty and blocked states above the home indicator', () => {
  test.skip(!apiIsStubbed(), 'The sheet is filled from a stubbed challenges API; run with E2E_STUB_API=1 against a local build.');

  for (const scenario of ['no-tokens', 'live'] as const) {
    test(`${scenario} at 390×844 with a home indicator: Close ends above it and is still at least ${MIN_HIT_PX} px tall`, async ({ page }) => {
      const { sheet } = await openSheetFromHeader(page, 'dark', 390, 844, scenario);
      const client = await page.context().newCDPSession(page);
      await client.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: HOME_INDICATOR_PX } });
      await waitForStylesApplied(page);
      const close = sheet.getByRole('button', { name: 'Close', exact: true }).filter({ hasText: 'Close' });
      await expect(close).toBeVisible();
      const box = await close.boundingBox();
      const viewportHeight = page.viewportSize()?.height ?? 0;
      expect(viewportHeight - ((box?.y ?? 0) + (box?.height ?? 0)), `${scenario}: Close ends above the home indicator`).toBeGreaterThanOrEqual(HOME_INDICATOR_PX - ROUNDING_PX);
      expect(box?.height ?? 0, `${scenario}: Close is a thumb target`).toBeGreaterThanOrEqual(MIN_HIT_PX - ROUNDING_PX);
      await client.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: 0 } });
    });
  }
});

test.describe('the send-a-challenge sheet: motion', () => {
  test.skip(!apiIsStubbed(), 'The sheet is filled from a stubbed challenges API; run with E2E_STUB_API=1 against a local build.');

  for (const { width, height } of [{ width: 375, height: 667 }, { width: 1280, height: 768 }]) {
    test(`with reduced motion the sheet does not move or fade on its way in at ${width} px`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(() => window.localStorage.setItem('theme', 'dark'));
      await stubSendSheetApi(page, { members: 7 });
      await page.setViewportSize({ width, height });
      await page.goto('/duels');
      await dismissOverlays(page);
      // Provet sätter på förhand en iakttagare som skriver upp arkets läge i varje bildruta från det att det finns i DOM:en.
      await page.evaluate(() => {
        const seen: Array<{ top: number; left: number; opacity: string }> = [];
        (window as unknown as { sheetFrames: typeof seen }).sheetFrames = seen;
        const tick = () => {
          const sheet = document.querySelector('.rq-duels-sheet');
          if (sheet) {
            const rect = sheet.getBoundingClientRect();
            seen.push({ top: rect.top, left: rect.left, opacity: getComputedStyle(sheet).opacity });
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await page.getByRole('region', { name: 'Your tokens' }).getByRole('button', { name: /^Send a minor challenge/ }).first().click();
      const sheet = page.getByRole('dialog', { name: 'Send a challenge' });
      await expect(sheet).toBeVisible();
      await page.waitForTimeout(600);

      const result = await page.evaluate(() => {
        const frames = (window as unknown as { sheetFrames: Array<{ top: number; left: number; opacity: string }> }).sheetFrames;
        const node = document.querySelector('.rq-duels-sheet')!;
        const style = getComputedStyle(node);
        return {
          frames: frames.length,
          tops: Array.from(new Set(frames.map((frame) => Math.round(frame.top * 10) / 10))),
          lefts: Array.from(new Set(frames.map((frame) => Math.round(frame.left * 10) / 10))),
          opacities: Array.from(new Set(frames.map((frame) => frame.opacity))),
          animationName: style.animationName,
          transitionDuration: style.transitionDuration,
          running: document.getAnimations().filter((animation) => animation.effect instanceof KeyframeEffect && node.contains((animation.effect as KeyframeEffect).target)).length,
        };
      });
      test.info().annotations.push({ type: 'measure', description: `${width} px: ${JSON.stringify(result)}` });
      expect(result.frames, 'the sheet was watched').toBeGreaterThan(0);
      expect(result.tops, 'the sheet stands still from its first frame').toHaveLength(1);
      expect(result.lefts, 'the sheet does not move sideways').toHaveLength(1);
      expect(result.opacities, 'the sheet does not fade').toEqual(['1']);
      expect(result.animationName, 'no animation on the sheet').toBe('none');
      expect(result.running, 'no running animations inside the sheet').toBe(0);
      expect(result.transitionDuration.split(',').every((duration) => parseFloat(duration) === 0), 'no transition on the sheet').toBe(true);
    });
  }
});

test.describe('the send-a-challenge sheet: a send on its way', () => {
  test.skip(!apiIsStubbed(), 'The sheet is filled from a stubbed challenges API; run with E2E_STUB_API=1 against a local build.');

  for (const { width, height } of [{ width: 375, height: 667 }, { width: 1280, height: 768 }]) {
    test(`at ${width} px Cancel, Escape and the scrim leave the sheet open while Sending… shows, the focus stays in the sheet, and the answer closes it`, async ({ page }) => {
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => { release = resolve; });
      await page.addInitScript(() => window.localStorage.setItem('theme', 'dark'));
      await stubSendSheetApi(page, { members: 7, holdSend: held });
      await page.setViewportSize({ width, height });
      await page.goto('/duels');
      await dismissOverlays(page);
      await page.getByRole('region', { name: 'Your tokens' }).getByRole('button', { name: /^Send a minor challenge: Most runs/ }).click();
      const sheet = page.getByRole('dialog', { name: 'Send a challenge' });
      await sheet.getByRole('radiogroup', { name: '3 · Pick an opponent' }).getByRole('radio', { name: /Anna Lindqvist/ }).click();
      await sheet.getByRole('button', { name: 'Send challenge' }).click();
      await expect(sheet.getByRole('button', { name: 'Sending…' })).toBeDisabled();

      await expect(sheet.getByRole('button', { name: 'Cancel' })).toBeDisabled();
      await expect(sheet.getByRole('button', { name: 'Close' })).toBeDisabled();
      const focusNow = () => page.evaluate(() => ({ tag: document.activeElement?.tagName ?? '', inside: !!document.activeElement?.closest('.rq-duels-sheet') }));
      // Send blev avstängd medan den hade fokus: fokus ligger kvar i arket, inte på body.
      expect(await focusNow(), 'after Send is switched off').toEqual({ tag: expect.not.stringMatching(/^BODY$/), inside: true });

      await page.keyboard.press('Escape');
      await expect(sheet).toBeVisible();
      expect(await focusNow(), 'after Escape').toEqual({ tag: expect.not.stringMatching(/^BODY$/), inside: true });

      await sheet.getByRole('button', { name: 'Cancel' }).click({ force: true });
      await sheet.getByRole('button', { name: 'Close' }).click({ force: true });
      await expect(sheet).toBeVisible();
      expect(await focusNow(), 'after a press on the disabled Cancel and Close').toEqual({ tag: expect.not.stringMatching(/^BODY$/), inside: true });

      await page.mouse.click(2, 2);
      await expect(sheet).toBeVisible();
      expect(await focusNow(), 'after a press on the scrim').toEqual({ tag: expect.not.stringMatching(/^BODY$/), inside: true });

      release();
      await expect(sheet).toHaveCount(0);
      await expect(page.locator('.rq-duels-notice')).toBeFocused();
      expect(new URL(page.url()).pathname).toBe('/duels');
    });
  }
});
