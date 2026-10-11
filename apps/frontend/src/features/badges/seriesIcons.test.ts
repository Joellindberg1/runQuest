import { describe, expect, it } from 'vitest';
import { BADGE_SERIES } from '@runquest/shared';
import { RQ_ICON_NAMES } from '@/shared/components/icons';

// Vakt (integrationskritikens F7): emblemet ritar serieikonen via RQIcon, som tyst faller tillbaka på en reservikon för ett okänt namn. En ny serie i shared
// med en ikon som saknas i RQIcon skulle alltså se "rätt" ut men visa fel symbol — det här testet gör det till ett fel i stället.

describe('serieikonerna', () => {
  it('varje BADGE_SERIES[].icon finns i RQ_ICON_NAMES', () => {
    expect(BADGE_SERIES.length).toBeGreaterThan(0);
    for (const series of BADGE_SERIES) {
      expect({ series: series.key, icon: series.icon, known: (RQ_ICON_NAMES as readonly string[]).includes(series.icon) }).toEqual({ series: series.key, icon: series.icon, known: true });
    }
  });

  it('serierna har olika ikoner (annars går de inte att skilja åt i en rad minis)', () => {
    const icons = BADGE_SERIES.map((series) => series.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });
});
