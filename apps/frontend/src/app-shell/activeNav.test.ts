import { describe, expect, it } from 'vitest';
import { activeSideNavItemFor, activeTabFor, destinationFor } from './activeNav';

// ADR 006 beslut 2: samma mappning som prototypens backMap.
describe('activeTabFor (bottenbarens aktiva flik)', () => {
  it.each([
    ['/board', 'ranks'],
    ['/runner/abc', 'ranks'],
    ['/events', 'ranks'],
    ['/titles', 'titles'],
    ['/duels', 'duels'],
    ['/profile', 'you'],
    ['/badges', 'you'],
    ['/log', 'you'],
    ['/news', 'you'],
    ['/playbook', 'you'],
    ['/features', 'you'],
    ['/settings', 'you'],
    ['/admin', 'you'],
  ])('%s → %s', (pathname, tab) => {
    expect(activeTabFor(pathname)).toBe(tab);
  });

  it('ingen flik lyser på okända adresser', () => {
    expect(activeTabFor('/nope')).toBeNull();
    expect(activeTabFor('/')).toBeNull();
  });
});

describe('activeSideNavItemFor (sidnavens aktiva rad)', () => {
  it('Runner card hör till Leaderboard', () => {
    expect(activeSideNavItemFor('/runner/abc')).toBe('board');
  });

  it('settings, admin och news saknar rad', () => {
    expect(activeSideNavItemFor('/settings')).toBeNull();
    expect(activeSideNavItemFor('/admin')).toBeNull();
    expect(activeSideNavItemFor('/news')).toBeNull();
  });

  it('övriga destinationer lyser på sin egen rad', () => {
    expect(activeSideNavItemFor('/duels')).toBe('duels');
    expect(activeSideNavItemFor('/log')).toBe('log');
  });

  it('/badges har en egen rad (ingen specialregel), skild från Profile', () => {
    expect(destinationFor('/badges')).toBe('badges');
    expect(activeSideNavItemFor('/badges')).toBe('badges');
    expect(activeSideNavItemFor('/profile')).toBe('profile');
  });
});
