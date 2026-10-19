import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LOADING_VIEW_SIZE, RoutePending } from './RoutePending';

// Storleken som ritas i webbläsaren (ca 217 x 167 px, tre gånger förra) bevisas av geometriprovet i apps/e2e/tests/landing.spec.ts. Här prövas bara kopplingen:
// RoutePending ritar ovalen med sin storlekskonstant, inte TrackLoaders standard och inte en egen siffra.
describe('the loading view', () => {
  it('draws the loader at its own size constant', () => {
    render(<RoutePending />);

    expect(screen.getByRole('status')).toHaveStyle({ width: `${LOADING_VIEW_SIZE}px` });
  });
});
