import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FrodoJourney } from './FrodoJourney';

// Karakteriseringstest av den äldre presentationen (egna profilen) innan inkrement 8 ritar om den:
// samma siffror som Runner card, så att frodoModel-extraktionen och en framtida omritning inte glider isär.

describe('FrodoJourney (egna profilen)', () => {
  it('988.4 km: Doors of Durin, 30.3 % och nästa punkt Balin\'s Tomb 49 km bort', () => {
    render(<FrodoJourney totalKm={988.4} />);

    expect(screen.getByText('Doors of Durin')).toBeInTheDocument();
    expect(screen.getByText(/30\.3% · 988 \/ 3.266 km/)).toBeInTheDocument();
    expect(screen.getByText("Balin's Tomb")).toBeInTheDocument();
    expect(screen.getByText(/49 km away/)).toBeInTheDocument();
  });

  it('zoomknappen cyklar Overview → Zoomed → Close-up → Overview och byter ändetiketter', () => {
    render(<FrodoJourney totalKm={988.4} />);

    expect(screen.getByText('The Shire')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Overview/ }));
    expect(screen.getByRole('button', { name: /Zoomed/ })).toBeInTheDocument();
    expect(screen.getByText('388 km')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Zoomed/ }));
    expect(screen.getByRole('button', { name: /Close-up/ })).toBeInTheDocument();
    expect(screen.getByText('788 km')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Close-up/ }));
    expect(screen.getByRole('button', { name: /Overview/ })).toBeInTheDocument();
  });

  it('framme: målmeddelande och ingen zoomknapp', () => {
    render(<FrodoJourney totalKm={3300} />);
    expect(screen.getByText(/Mount Doom reached/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
