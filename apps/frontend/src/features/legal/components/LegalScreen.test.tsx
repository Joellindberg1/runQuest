import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DATA_CONTROLLER, getDataPolicy, getTerms } from '@runquest/shared';
import { LEGAL_PRIVACY_ID, LEGAL_TERMS_ID, paths } from '@/paths';
import { LegalScreen } from './LegalScreen';

// /legal är publik och gör inga anrop: ingen QueryClientProvider, ingen AuthContext, bara routern för länkarna.
const renderLegal = (entry: string = paths.legal) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <LegalScreen />
    </MemoryRouter>,
  );

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('LegalScreen — struktur och tillgänglighet', () => {
  it('has one h1, landmarks and privacy and terms anchors', () => {
    const { container } = renderLegal();

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy & Terms' })).toBeInTheDocument();
    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1);

    const privacy = container.querySelector(`section#${LEGAL_PRIVACY_ID}`);
    const terms = container.querySelector(`section#${LEGAL_TERMS_ID}`);
    expect(privacy).not.toBeNull();
    expect(terms).not.toBeNull();
    expect(within(privacy as HTMLElement).getByRole('heading', { level: 2, name: 'Privacy' })).toBeInTheDocument();
    expect(within(terms as HTMLElement).getByRole('heading', { level: 2, name: 'Terms' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Privacy' })).toBe(privacy);
    expect(screen.getByRole('region', { name: 'Terms' })).toBe(terms);
  });

  it('links back to the landing page from the header', () => {
    renderLegal();
    const back = within(screen.getByRole('banner')).getByRole('link', { name: 'Back to RunQuest' });
    expect(back).toHaveAttribute('href', paths.landing);
  });

  it('keeps the heading levels in order: h1, h2 per part, h3 per section', () => {
    renderLegal();
    const levels = screen.getAllByRole('heading').map((heading) => Number(heading.tagName[1]));
    const policy = getDataPolicy().sections.length;
    expect(levels).toEqual([1, 2, ...Array(policy).fill(3), 2, 3]);
  });
});

describe('LegalScreen — innehåll ur den delade källan', () => {
  it('legal page shows the controller name and contact address from the shared source', () => {
    renderLegal();
    const privacy = screen.getByRole('region', { name: 'Privacy' });

    expect(within(privacy).getAllByText(new RegExp(DATA_CONTROLLER.name)).length).toBeGreaterThan(0);
    const contacts = within(privacy).getAllByRole('link', { name: DATA_CONTROLLER.email });
    for (const contact of contacts) expect(contact).toHaveAttribute('href', `mailto:${DATA_CONTROLLER.email}`);
  });

  it('shows the policy version', () => {
    renderLegal();
    expect(screen.getByText(`Version ${getDataPolicy().version}`)).toBeInTheDocument();
  });

  it('renders every privacy section as an h3 with its own anchor id, one paragraph per source paragraph', () => {
    renderLegal();
    const privacy = screen.getByRole('region', { name: 'Privacy' });

    for (const section of getDataPolicy().sections) {
      const heading = within(privacy).getByRole('heading', { level: 3, name: section.title });
      expect(heading).toHaveAttribute('id', `legal-${section.id}`);
      const article = within(privacy).getByRole('article', { name: section.title });
      const rendered = [...article.querySelectorAll('p')].map((p) => p.textContent);
      expect(rendered).toEqual([...section.paragraphs]);
    }
  });

  it('renders the terms section from the shared source with a heading id that does not collide with the terms anchor', () => {
    const { container } = renderLegal();
    const terms = screen.getByRole('region', { name: 'Terms' });
    const [section] = getTerms().sections;

    const heading = within(terms).getByRole('heading', { level: 3, name: section.title });
    expect(heading).toHaveAttribute('id', 'legal-terms');
    expect(container.querySelectorAll(`[id="${LEGAL_TERMS_ID}"]`)).toHaveLength(1);
    const rendered = [...within(terms).getByRole('article', { name: section.title }).querySelectorAll('p')].map((p) => p.textContent);
    expect(rendered).toEqual([...section.paragraphs]);
  });

  it('gives every element id on the page once', () => {
    const { container } = renderLegal();
    const ids = [...container.querySelectorAll('[id]')].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses the shared source to name the footer contact too', () => {
    renderLegal();
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('link', { name: DATA_CONTROLLER.email })).toHaveAttribute('href', `mailto:${DATA_CONTROLLER.email}`);
  });
});

describe('LegalScreen — kopplingar', () => {
  it('legal page makes no network calls', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const xhrOpen = vi.spyOn(XMLHttpRequest.prototype, 'open');
    renderLegal();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();
  });

  it('sets title, description and canonical for /legal while mounted and restores them on unmount', () => {
    document.head.innerHTML =
      '<title>Run Quest</title><meta name="description" content="Gamification for running" /><link rel="canonical" href="https://www.runquest.dev/" />';
    const description = () => document.head.querySelector('meta[name="description"]');
    const canonical = () => document.head.querySelector('link[rel="canonical"]');

    const { unmount } = renderLegal();
    expect(document.title).toBe('Privacy & Terms — RunQuest');
    expect(description()?.getAttribute('content')).toMatch(/\S/);
    expect(description()?.getAttribute('content')).not.toMatch(/\d/);
    expect(canonical()).toHaveAttribute('href', 'https://www.runquest.dev/legal');

    unmount();
    expect(document.title).toBe('Run Quest');
    expect(description()).toHaveAttribute('content', 'Gamification for running');
    expect(canonical()).toHaveAttribute('href', 'https://www.runquest.dev/');
    document.head.innerHTML = '';
  });

  it('scrolls to the terms anchor when the page opens with #terms', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    scroll.mockClear();
    const { container } = renderLegal(`${paths.legal}#${LEGAL_TERMS_ID}`);
    expect(scroll.mock.contexts).toEqual([container.querySelector(`#${LEGAL_TERMS_ID}`)]);
  });
});
