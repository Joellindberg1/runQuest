import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { POINTER_SETTLE_MS } from '../newsModel';
import { NOW_ISO, at, levelUp, newsServer } from '../news.fixture';
import { handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import '@/test/pointerEvent';
import { NewsScreen } from './NewsScreen';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
// Turen startar driver.js efter en timer och hör inte till det som provas här.
vi.mock('@/features/onboarding/components/FeatureTour', () => ({ FeatureTour: () => null }));

// Skärmens egen datakoppling för kvittering. Radernas gester provas i NewsRow.test.tsx, och sidans övriga beteende i pages/NewsPage.test.tsx.

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW_ISO));
  resetFakeBackend();
});
afterEach(() => vi.useRealTimers());

describe('NewsScreen — Mark all read', () => {
  it('Mark all read fungerar fortfarande och nollar räknaren', async () => {
    const news = newsServer([levelUp(3, 15, { occurred_at: at(1) }), levelUp(2, 20, { occurred_at: at(2) }), levelUp(1, 25, { occurred_at: at(3) })], 0);
    handlers.getNews = (...args: unknown[]) => news.getNews(...(args as [never]));
    handlers.markNewsSeen = (...args: unknown[]) => news.markNewsSeen(...(args as [never]));
    handlers.markNewsRead = (...args: unknown[]) => news.markNewsRead(...(args as [never]));
    renderWithApp(<NewsScreen />, { entry: '/news' });
    await screen.findByText('3 unread');

    // En rad läst per gest först, sedan resten med knappen.
    act(() => { vi.advanceTimersByTime(POINTER_SETTLE_MS); });
    fireEvent.pointerEnter(screen.getByRole('button', { name: /Karl reached level 15$/ }), { pointerType: 'mouse' });
    await screen.findByText('2 unread');
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));

    expect(await screen.findByText('All caught up')).toBeInTheDocument();
    await waitFor(() => expect(news.server.seenCalls).toEqual([3]));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('2 marked as read'));
    expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull();
    for (const button of screen.getAllByRole('button', { name: /Karl reached level/ })) expect(button).not.toHaveAccessibleName(/unread/);
  });
});
