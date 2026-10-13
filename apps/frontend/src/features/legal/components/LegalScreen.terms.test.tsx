import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DATA_CONTROLLER } from '@runquest/shared';
import { paths } from '@/paths';
import { LegalScreen } from './LegalScreen';

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
