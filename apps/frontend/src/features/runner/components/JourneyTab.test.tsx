import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import type { User } from '@runquest/types';
import { ME, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import ProfilePage from '@/pages/ProfilePage';
import { RunnerPopup } from './RunnerPopup';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
vi.mock('@/features/onboarding/components/FeatureTour', () => ({ FeatureTour: () => null }));
vi.mock('@/features/badges/api', () => ({
  badgesApi: {
    getUserBadges: async () => ({ items: [], showcase: [] }),
    getGroupBadges: async () => ({ members: [], holders: {}, member_count: 2 }),
  },
}));

// The Journey tab of the profile popup: Frodo's way drawn from the same model as the profile's Frodo card (`frodoModel`), so the same total_km gives the same numbers in the
// popup, in the banner and on the profile.

const DESKTOP = 1280;
const noop = () => {};

const KARL_ID = 'u-karl';
const runnerWith = (totalKm: number): User => ({
  ...ME, id: KARL_ID, name: 'Karl Persson', total_xp: 5539, total_km: totalKm, current_streak: 0, longest_streak: 0, wins: 0, draws: 0, losses: 2, runs: [], challenge_counts: {},
});

beforeEach(() => {
  resetFakeBackend();
  handlers.getUserTitles = () => ({ success: true, data: [] });
  handlers.getTitleLeaderboard = () => ({ success: true, data: [] });
  handlers.getHeadToHead = () => ({
    success: true,
    data: { opponent: { id: KARL_ID, name: 'Karl Persson', profile_picture: null }, record: { wins: 1, draws: 0, losses: 0, total: 1 }, history: [], active: null },
  });
});

/** Opens the popup for a runner with the given total_km and selects The Journey. */
async function openJourney(totalKm: number) {
  const runner = runnerWith(totalKm);
  handlers.getUsersWithRuns = () => ({ success: true, data: [ME, runner] });
  const rendered = renderWithApp(<RunnerPopup id={KARL_ID} runner={runner} users={[ME, runner]} failure={null} failed={false} onClose={noop} />, {
    entry: `/runner/${KARL_ID}`,
    width: DESKTOP,
  });
  await screen.findByRole('heading', { level: 1, name: 'Karl Persson' });
  await userEvent.setup().click(screen.getByRole('tab', { name: 'The Journey' }));
  const journey = await screen.findByRole('region', { name: "Frodo's journey" });
  return { ...rendered, journey, panel: screen.getByRole('tabpanel') };
}

/** What a reader of the Frodo card is told, as text: the road's labels, the last checkpoint line, the progress line and the progress bar. */
function readJourney(journey: HTMLElement) {
  const bar = within(journey).queryByRole('progressbar');
  return {
    labels: [...journey.querySelectorAll('[class$="-wp__label"]')].map((label) => label.textContent),
    checkpoint: within(journey).queryByText(/^Last checkpoint/)?.textContent ?? null,
    progress: within(journey).queryByText(/ km$/)?.textContent ?? null,
    valueNow: bar?.getAttribute('aria-valuenow') ?? null,
    valueText: bar?.getAttribute('aria-valuetext') ?? null,
  };
}

describe('the Journey tab', () => {
  it('shows the same numbers as the profile and the banner for the same total_km', async () => {
    const TOTAL_KM = 988.4;

    handlers.getUsersWithRuns = () => ({ success: true, data: [{ ...ME, total_km: TOTAL_KM }, runnerWith(TOTAL_KM)] });
    const profile = renderWithApp(<Routes><Route path="/profile" element={<ProfilePage />} /></Routes>, { entry: '/profile', width: DESKTOP });
    const onProfile = readJourney(await screen.findByRole('region', { name: "Frodo's journey" }));
    profile.unmount();

    const { journey } = await openJourney(TOTAL_KM);
    const inPopup = readJourney(journey);

    expect(inPopup.checkpoint).toBe('Last checkpoint Doors of Durin');
    expect(inPopup.progress).toBe(`30.3% · 988 / 3\u00a0266 km`);
    expect(inPopup.labels).toEqual(['Bree', 'Rivendell', 'Moria', 'Rauros', 'The Black Gate']);
    expect(inPopup).toEqual(onProfile);

    // The banner states the same distance, to one decimal, from the same user.
    const banner = screen.getByRole('region', { name: 'Runner' });
    expect(banner.querySelector('.rq-runner-cells [data-cell="km"] dd')).toHaveTextContent('988.4');
  });

  it('gives the progress bar a text for screen readers: percent, km and the last checkpoint', async () => {
    const { journey } = await openJourney(988.4);

    const bar = within(journey).getByRole('progressbar', { name: 'Progress to Mount Doom' });
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuenow', '30');
    expect(bar).toHaveAttribute('aria-valuetext', '30.3% of the way to Mount Doom, 988 of 3\u00a0266 km, last checkpoint Doors of Durin');
  });

  it('journey tab contains no button without an action', async () => {
    const { panel } = await openJourney(988.4);

    // Every button and button-like element in the tab must change what the tab shows when it is pressed: a button that does nothing is not drawn.
    const pressable = () => [...panel.querySelectorAll<HTMLElement>('button, [role="button"]')];
    expect(pressable().length, 'the tab has the zoom button').toBeGreaterThan(0);
    for (let step = 0; step < 3; step += 1) {
      const buttons = pressable();
      expect(buttons).toHaveLength(1);
      const before = panel.innerHTML;
      fireEvent.click(buttons[0]!);
      expect(panel.innerHTML, `pressing "${buttons[0]!.textContent}" changed nothing`).not.toBe(before);
    }
  });

  it('draws no button at all when there is nothing to zoom: at 0 km and when Mount Doom is reached', async () => {
    for (const totalKm of [0, 3266]) {
      const { panel, unmount } = await openJourney(totalKm);
      expect(panel.querySelectorAll('button, [role="button"]'), `buttons at ${totalKm} km`).toHaveLength(0);
      unmount();
    }
  });

  describe('edge cases', () => {
    const cases: ReadonlyArray<{ name: string; km: number; checkpoint: string; progress: string; valueNow: string; spoken?: string }> = [
      { name: '0 km', km: 0, checkpoint: 'The Shire', progress: '0.0% · 0 / 3\u00a0266 km', valueNow: '0' },
      { name: 'between two milestones (Rivendell 457, Hollin 602)', km: 530, checkpoint: 'Rivendell', progress: '16.2% · 530 / 3\u00a0266 km', valueNow: '16' },
      { name: 'exactly on a milestone (Moria 1181)', km: 1181, checkpoint: 'Moria', progress: '36.2% · 1\u00a0181 / 3\u00a0266 km', valueNow: '36' },
      { name: 'late on the way (Gorgoroth 3031, Sammath Naur 3148)', km: 3100, checkpoint: 'Gorgoroth', progress: '94.9% · 3\u00a0100 / 3\u00a0266 km', valueNow: '95' },
      // Rounding never claims more than has been reached: the km are cut, and the percent cannot read 100.0 before the end.
      { name: 'just before Moria (1180.6 km)', km: 1180.6, checkpoint: "Balin's Tomb", progress: '36.1% · 1\u00a0180 / 3\u00a0266 km', valueNow: '36', spoken: "36.1% of the way to Mount Doom, 1\u00a0180 of 3\u00a0266 km, last checkpoint Balin's Tomb" },
      { name: 'just before Moria (1180.99 km)', km: 1180.99, checkpoint: "Balin's Tomb", progress: '36.2% · 1\u00a0180 / 3\u00a0266 km', valueNow: '36', spoken: "36.2% of the way to Mount Doom, 1\u00a0180 of 3\u00a0266 km, last checkpoint Balin's Tomb" },
      { name: 'just before Mount Doom (3265.7 km)', km: 3265.7, checkpoint: 'Sammath Naur', progress: '99.9% · 3\u00a0265 / 3\u00a0266 km', valueNow: '99', spoken: '99.9% of the way to Mount Doom, 3\u00a0265 of 3\u00a0266 km, last checkpoint Sammath Naur' },
      { name: 'just before Mount Doom (3265.99 km)', km: 3265.99, checkpoint: 'Sammath Naur', progress: '99.9% · 3\u00a0265 / 3\u00a0266 km', valueNow: '99', spoken: '99.9% of the way to Mount Doom, 3\u00a0265 of 3\u00a0266 km, last checkpoint Sammath Naur' },
    ];

    it.each(cases)('$name: checkpoint, progress line and bar agree, and no number is NaN or negative', async ({ km, checkpoint, progress, valueNow, spoken }) => {
      const { journey } = await openJourney(km);

      const read = readJourney(journey);
      expect(read.checkpoint).toBe(`Last checkpoint ${checkpoint}`);
      expect(read.progress).toBe(progress);
      expect(read.valueNow).toBe(valueNow);
      if (spoken) expect(read.valueText).toBe(spoken);
      const bar = within(journey).getByRole('progressbar');
      const fill = (bar as HTMLElement).style.getPropertyValue('--w');
      expect(Number.parseFloat(fill)).toBeGreaterThanOrEqual(0);
      expect(Number.parseFloat(fill)).toBeLessThanOrEqual(100);
      const everything = `${journey.textContent} ${[...journey.querySelectorAll('*')].flatMap((element) => [...element.attributes].map((attribute) => attribute.value)).join(' ')}`;
      expect(everything).not.toMatch(/NaN|undefined|(^|[^\w])-\d/);
    });

    it.each([3266, 3500])('%i km: Mount Doom is reached, the bar is full and says so, and no progress line is drawn', async (km) => {
      const { journey } = await openJourney(km);

      expect(within(journey).getByText('Mount Doom reached — the Ring is destroyed.')).toBeInTheDocument();
      const bar = within(journey).getByRole('progressbar');
      expect(bar).toHaveAttribute('aria-valuenow', '100');
      expect(bar).toHaveAttribute('aria-valuetext', 'Mount Doom reached');
      expect(Number.parseFloat((bar as HTMLElement).style.getPropertyValue('--w'))).toBe(100);
      expect(journey.textContent).not.toMatch(/NaN|Last checkpoint/);
    });
  });
});
