import { describe, expect, it } from 'vitest';
import { firstName } from '@/shared/utils/format';
import { placeLabel, restOfName } from './podiumName';

describe('placeLabel', () => {
  it('plats 1-3 har sina ordningstal, och ett högre tal får "th"', () => {
    expect([1, 2, 3].map(placeLabel)).toEqual(['1st place', '2nd place', '3rd place']);
    expect(placeLabel(4)).toBe('4th place');
  });
});

describe('restOfName', () => {
  it('allt efter förnamnet, med enkla mellanrum', () => {
    expect(restOfName('Karl Persson')).toBe('Persson');
    expect(restOfName('Nicklas von Elling')).toBe('von Elling');
    expect(restOfName('Daniel Lindblad Lüthje')).toBe('Lindblad Lüthje');
    expect(restOfName('  Anna   Maria  Lindqvist ')).toBe('Maria  Lindqvist');
  });

  it('ett ord långt namn, ett bindestreckat ord och ett tomt namn har inget efternamn', () => {
    expect(restOfName('Karl')).toBe('');
    expect(restOfName('Anna-Karin')).toBe('');
    expect(restOfName('Montgomery-Featherstonehaugh')).toBe('');
    expect(restOfName('')).toBe('');
  });

  it('förnamnet delas på mellanrum, inte på bindestreck, och förnamn plus efternamn ger tillbaka namnet', () => {
    expect(firstName('Anna-Karin Svensson')).toBe('Anna-Karin');
    expect(restOfName('Anna-Karin Svensson')).toBe('Svensson');
    for (const name of ['Karl Persson', 'Nicklas von Elling', 'Ann Pneumonoultramicroscopicsilicovolcanoconiosis']) {
      expect(`${firstName(name)} ${restOfName(name)}`).toBe(name);
    }
  });
});
