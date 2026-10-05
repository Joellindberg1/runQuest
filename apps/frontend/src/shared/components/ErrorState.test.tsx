import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ErrorState } from './ErrorState';

describe('ErrorState (regel 9: rött kantkort, Retry, datan är säker)', () => {
  it('visar rubrik, en mening om att datan är säker och en Retry-knapp', () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Couldn't load the week" onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toHaveClass('rq-card--edge');
    expect(screen.getByRole('heading', { name: "Couldn't load the week" })).toBeInTheDocument();
    expect(screen.getByText(/Your data is safe/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('under omförsök är knappen avstängd och säger det', () => {
    render(<ErrorState onRetry={() => {}} retrying />);
    expect(screen.getByRole('button', { name: 'Retrying…' })).toBeDisabled();
  });
});
