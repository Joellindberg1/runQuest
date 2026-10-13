import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { usePageMetadata } from './usePageMetadata';

const META = { title: 'Page — RunQuest', description: 'A short description.', canonical: 'https://www.runquest.dev/page' };

function Probe() {
  usePageMetadata(META);
  return null;
}

const TITLE = '<title>Run Quest</title>';
const setHead = (html: string) => {
  document.head.innerHTML = `${TITLE}${html}`;
};
const description = () => document.head.querySelector('meta[name="description"]');
const canonical = () => document.head.querySelector('link[rel="canonical"]');

beforeEach(() => {
  setHead(
    '<meta name="description" content="Gamification for running" /><link rel="canonical" href="https://www.runquest.dev/" />',
  );
});

afterEach(() => {
  document.head.innerHTML = '';
});

describe('usePageMetadata', () => {
  it('sets title, description and canonical while mounted and restores them on unmount', () => {
    const { unmount } = render(<Probe />);
    expect(document.title).toBe(META.title);
    expect(description()).toHaveAttribute('content', META.description);
    expect(canonical()).toHaveAttribute('href', META.canonical);

    unmount();
    expect(document.title).toBe('Run Quest');
    expect(description()).toHaveAttribute('content', 'Gamification for running');
    expect(canonical()).toHaveAttribute('href', 'https://www.runquest.dev/');
  });

  it('leaves the head alone when the description and canonical elements do not exist', () => {
    setHead('');
    const { unmount } = render(<Probe />);
    expect(document.title).toBe(META.title);
    expect(description()).toBeNull();
    expect(canonical()).toBeNull();

    unmount();
    expect(document.title).toBe('Run Quest');
    expect(document.head.children).toHaveLength(1);
  });
});
