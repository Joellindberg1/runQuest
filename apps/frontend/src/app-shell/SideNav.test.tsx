import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { SideNav } from './SideNav';
import { renderWithApp } from '@/test/renderApp';

const DESKTOP = 1280;
const TOUR_ANCHORS = ['nav-ranks', 'nav-titles', 'nav-duels', 'nav-events', 'nav-you', 'nav-new'];

const renderNav = (entry: string) => renderWithApp(<SideNav rightNow={[]} />, { entry, width: DESKTOP });
const primary = () => screen.getByRole('navigation', { name: 'Primary' });

describe('SideNav: Badges-raden', () => {
  it('Badges ligger i gruppen You, mellan Profile och Log Runs, och länkar till /badges', () => {
    renderNav('/board');

    const labels = within(primary()).getAllByRole('link').map((link) => link.textContent);
    const profile = labels.indexOf('Profile');
    expect(labels.slice(profile, profile + 3)).toEqual(['Profile', 'Badges', 'Log Runs']);
    expect(screen.getByRole('link', { name: 'Badges' })).toHaveAttribute('href', '/badges');
  });

  it('raden är aktiv med aria-current="page" på /badges, och Profile är det inte', () => {
    renderNav('/badges');

    expect(screen.getByRole('link', { name: 'Badges' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Profile' })).not.toHaveAttribute('aria-current');
    expect(primary().querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it('raden är inte aktiv på andra sidor', () => {
    renderNav('/profile');

    expect(screen.getByRole('link', { name: 'Badges' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
  });

  it('Badges har inget tour-ankare och de befintliga ankarna är oförändrade', () => {
    renderNav('/board');

    expect(screen.getByRole('link', { name: 'Badges' })).not.toHaveAttribute('data-tour');
    const anchors = Array.from(primary().querySelectorAll('[data-tour]')).map((el) => el.getAttribute('data-tour'));
    expect(anchors).toEqual(TOUR_ANCHORS);
  });
});
