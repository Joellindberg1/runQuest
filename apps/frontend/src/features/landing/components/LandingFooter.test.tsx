import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
// Filens text läses som rå sträng (inte via den namngivna JSON-importen som komponenten använder), så testet jämför mot det som står på disk.
import packageJsonText from '../../../../package.json?raw';

const theme = vi.hoisted(() => ({ resolvedTheme: undefined as string | undefined }));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: theme.resolvedTheme }) }));

import { LandingFooter } from './LandingFooter';

const renderFooter = () =>
  render(
    <MemoryRouter>
      <LandingFooter />
    </MemoryRouter>,
  );

const packageVersion = (JSON.parse(packageJsonText) as { version: string }).version;

afterEach(() => {
  theme.resolvedTheme = undefined;
});

describe('LandingFooter', () => {
  it('footern länkar till /legal för integritet och villkor', () => {
    renderFooter();
    const legal = within(screen.getByRole('navigation', { name: 'Legal' }));
    expect(legal.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/legal#privacy');
    expect(legal.getByRole('link', { name: 'Legal' })).toHaveAttribute('href', '/legal#terms');
  });

  it('footern visar den riktiga versionen ur bygget', () => {
    renderFooter();
    expect(packageVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(within(screen.getByRole('contentinfo')).getByText(`v${packageVersion}`)).toBeInTheDocument();
  });

  it('footern innehåller Strava-attribution med alt-text', () => {
    renderFooter();
    const logo = within(screen.getByRole('contentinfo')).getByRole('img', { name: 'Compatible with Strava' });
    expect(logo).toHaveAttribute('src', '/brand/api_logo_cptblWith_strava_horiz_white.svg');
    expect(logo.closest('a')).toBeNull();
  });

  it('på ljus botten visas den svarta Strava-loggan', () => {
    theme.resolvedTheme = 'light';
    renderFooter();
    expect(screen.getByRole('img', { name: 'Compatible with Strava' })).toHaveAttribute('src', '/brand/api_logo_cptblWith_strava_horiz_black.svg');
  });

  it('footern saknar länkar till inloggade sidor och FAQ', () => {
    renderFooter();
    const hrefs = within(screen.getByRole('contentinfo')).getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual(['/legal#privacy', '/legal#terms']);
    expect(screen.queryByText(/playbook|faq|bug report/i)).toBeNull();
  });

  it('varumärkesraden finns kvar och loggan står utanför länknavigeringen', () => {
    renderFooter();
    expect(screen.getByText('Run · Rank · Reign', { exact: false })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Legal' })).queryByRole('img')).toBeNull();
  });
});
