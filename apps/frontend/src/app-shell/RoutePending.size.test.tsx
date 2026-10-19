import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoutePending } from './RoutePending';

// RoutePending är den enda laddningsvyn och den som ritas i index.html, i överlämningen och i gaten. Den är tre gånger så stor som den var (64 px bred): ägaren
// ville att den skulle synas tydligare. Övriga TrackLoader-platser sätter sin egen storlek och påverkas inte (deras tester och markup är oförändrade).
describe('the loading view', () => {
  it('draws the loader three times as large as before: 192 px wide, 0.62 as tall', () => {
    render(<RoutePending />);

    expect(screen.getByRole('status')).toHaveStyle({ width: '192px', height: `${192 * 0.62}px` });
  });

  it('still announces "Loading" and draws all three lanes with a runner on each', () => {
    render(<RoutePending />);
    const status = screen.getByRole('status');

    expect(status).toHaveTextContent('Loading');
    expect(status.querySelectorAll('svg path')).toHaveLength(3);
    expect(status.querySelectorAll(':scope > div')).toHaveLength(3);
  });
});
