import { describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import FeaturesPage from './FeaturesPage';
import { changelog } from '@/features/changelog/changelogData';
import { renderWithApp } from '@/test/renderApp';

const MOBILE = 390;
const DESKTOP = 1280;
const [latest, second] = changelog.releases;

const location = () => screen.getByTestId('location').textContent;
const releaseButton = (release: { version: string }) => screen.getByRole('button', { name: new RegExp(`v${release.version.replace(/\./g, '\\.')}`) });

describe('Feature & Version — rubrik och flikar', () => {
  it('versionen och datumet kommer ur changelog.json (den senaste posten), inte ur koden', () => {
    renderWithApp(<FeaturesPage />, { entry: '/features' });
    expect(screen.getByRole('heading', { level: 1, name: 'Feature & Version' })).toBeInTheDocument();
    expect(screen.getByText(`Version ${latest.version} · released ${latest.date}`)).toBeInTheDocument();
    expect(screen.queryByText(/0\.4\.2/)).toBeNull();
  });

  it('tre flikar i prototypens ordning och Features är vald som standard', () => {
    renderWithApp(<FeaturesPage />, { entry: '/features' });
    const tabs = within(screen.getByRole('tablist', { name: 'Feature and version view' })).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Features', 'Working on', 'Releases']);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tabs[0].id);
  });

  it('flikbyte skriver ?view= (delbar adress), och en okänd adress faller tillbaka på Features', () => {
    renderWithApp(<FeaturesPage />, { entry: '/features?view=nonsense' });
    expect(screen.getByRole('tab', { name: 'Features' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Releases' }));
    expect(location()).toBe('/features?view=releases');
    expect(screen.getByRole('tab', { name: 'Releases' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Feature & Version — Features', () => {
  it.each([MOBILE, DESKTOP])('visar varje feature ur datan med titel och beskrivning (%ipx)', (width) => {
    renderWithApp(<FeaturesPage />, { entry: '/features', width });
    const cards = within(screen.getByRole('tabpanel')).getAllByRole('listitem');
    expect(cards).toHaveLength(changelog.features.length);
    for (const feature of changelog.features) {
      expect(screen.getByRole('heading', { level: 2, name: feature.title })).toBeInTheDocument();
      expect(screen.getByText(feature.body)).toBeInTheDocument();
    }
  });

  it('har inga knappar utöver flikarna (inget guld, inget att trycka på)', () => {
    renderWithApp(<FeaturesPage />, { entry: '/features' });
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).queryAllByRole('button')).toHaveLength(0);
  });
});

describe('Feature & Version — Working on', () => {
  it('visar korten med detaljerna ur datan', () => {
    renderWithApp(<FeaturesPage />, { entry: '/features?view=working' });
    const panel = screen.getByRole('tabpanel');
    for (const item of changelog.workingOn) {
      expect(within(panel).getByRole('heading', { level: 2, name: item.title })).toBeInTheDocument();
      expect(within(panel).getByText(item.body)).toBeInTheDocument();
      for (const detail of item.details) expect(within(panel).getAllByText(detail).length).toBeGreaterThan(0);
    }
  });
});

describe('Feature & Version — Releases', () => {
  it('listar alla releaser nyaste först, med typ, version, rubrik och datum', () => {
    renderWithApp(<FeaturesPage />, { entry: '/features?view=releases' });
    const rows = within(screen.getByRole('tabpanel')).getAllByRole('button');
    expect(rows).toHaveLength(changelog.releases.length);
    expect(rows[0]).toHaveTextContent(`v${latest.version}`);
    expect(rows[0]).toHaveTextContent(latest.title);
    expect(rows[0]).toHaveTextContent(latest.date);
    expect(rows[0]).toHaveTextContent(/Minor/);
    // Äldre poster (v0.x) visas kvar — historiken försvinner inte
    expect(rows[rows.length - 1]).toHaveTextContent('v0.1.0');
  });

  it('den senaste börjar öppen och listar sina ändringar med typ och text', () => {
    renderWithApp(<FeaturesPage />, { entry: '/features?view=releases' });
    expect(releaseButton(latest)).toHaveAttribute('aria-expanded', 'true');
    expect(releaseButton(second)).toHaveAttribute('aria-expanded', 'false');
    const list = screen.getByRole('list', { name: `Changes in version ${latest.version}` });
    expect(within(list).getAllByRole('listitem')).toHaveLength(latest.changes.length);
    expect(within(list).getByText(latest.changes[0].description)).toBeInTheDocument();
    // knappen pekar på sin panel
    expect(releaseButton(latest)).toHaveAttribute('aria-controls', list.id);
  });

  it('en öppen åt gången: ett klick på en annan byter, ett klick på den öppna stänger', () => {
    renderWithApp(<FeaturesPage />, { entry: '/features?view=releases' });
    fireEvent.click(releaseButton(second));
    expect(releaseButton(second)).toHaveAttribute('aria-expanded', 'true');
    expect(releaseButton(latest)).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list', { name: `Changes in version ${latest.version}` })).toBeNull();
    expect(screen.getByRole('list', { name: `Changes in version ${second.version}` })).toBeInTheDocument();

    fireEvent.click(releaseButton(second));
    expect(releaseButton(second)).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryAllByRole('list', { name: /Changes in version/ })).toHaveLength(0);
  });

  it('en bugfix-ändring märks som Bugfix och en feature som Feature', () => {
    renderWithApp(<FeaturesPage />, { entry: '/features?view=releases' });
    const bugfixRelease = changelog.releases.find((release) => release.changes.some((change) => change.type === 'bugfix'));
    expect(bugfixRelease).toBeDefined();
    fireEvent.click(releaseButton(bugfixRelease!));
    const list = screen.getByRole('list', { name: `Changes in version ${bugfixRelease!.version}` });
    expect(within(list).getByText('Bugfix')).toBeInTheDocument();
  });

  it('öppna releaser behåller sin öppna release när man byter flik och tillbaka', () => {
    renderWithApp(<FeaturesPage />, { entry: '/features?view=releases' });
    fireEvent.click(releaseButton(second));
    fireEvent.click(screen.getByRole('tab', { name: 'Features' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Releases' }));
    expect(releaseButton(second)).toHaveAttribute('aria-expanded', 'true');
  });
});
