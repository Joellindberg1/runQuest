import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DATA_CONTROLLER } from '@runquest/shared';
import { paths } from '@/paths';
import { LegalScreen } from './LegalScreen';

// FIXTUR: tas bort av Lead vid integrationen när B:s text finns
// Skelettet i shared har utkasttext ("Draft."). Mocken ger villkoren det innehåll testet prövar, bara i den här filen.
// Testet nedan är skrivet så att det går grönt mot B:s riktiga text när hela mock-blocket tas bort (importen av `vi` också).
vi.mock('@runquest/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@runquest/shared')>();
  const termsSection = {
    id: 'terms',
    title: 'Terms',
    paragraphs: [
      'RunQuest is a private hobby project. It is provided "as is", with no warranty of any kind.',
      `Questions? Write to ${actual.DATA_CONTROLLER.email}.`,
    ],
  };
  return {
    ...actual,
    getTerms: () => ({ version: actual.DATA_POLICY_VERSION, controller: actual.DATA_CONTROLLER, sections: [termsSection] }),
  };
});
// FIXTUR slut

describe('LegalScreen — villkorens innehåll', () => {
  it('legal page has a terms section that says as is, no warranty, private hobby project and gives the contact address', () => {
    render(
      <MemoryRouter initialEntries={[paths.legal]}>
        <LegalScreen />
      </MemoryRouter>,
    );
    const terms = screen.getByRole('region', { name: 'Terms' });
    const text = (terms.textContent ?? '').toLowerCase();

    expect(text).toContain('as is');
    expect(text).toContain('no warranty');
    expect(text).toContain('private hobby project');
    expect(text).toContain(DATA_CONTROLLER.email.toLowerCase());
    const contacts = within(terms).getAllByRole('link', { name: DATA_CONTROLLER.email });
    for (const contact of contacts) expect(contact).toHaveAttribute('href', `mailto:${DATA_CONTROLLER.email}`);
  });
});
