import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/shared/utils/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { log } from '@/shared/utils/logger';
import NotFound from './NotFound';

describe('NotFound', () => {
  it('shows the page and warns about the missing route without reporting an error', () => {
    render(
      <MemoryRouter initialEntries={['/no-such-page']}>
        <NotFound />
      </MemoryRouter>,
    );

    expect(screen.getByText('Page not found')).toBeInTheDocument();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('non-existent route'), '/no-such-page');
    expect(log.error).not.toHaveBeenCalled();
  });
});
