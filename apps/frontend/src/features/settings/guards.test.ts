import { describe, expect, it } from 'vitest';
import { defineDesignGuards } from '@/test/designGuards';

const sources = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '../../pages/SettingsPage.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

defineDesignGuards({
  name: 'Settings-filerna',
  baseUrl: import.meta.url,
  sources,
  cssFiles: ['./settings.css'],
  tokenPrefix: '--rq-settings-',
  localVars: ['--rq-edge', '--rq-edge-line', '--rq-form-gap'],
});

describe('Settings — regel 3 (en guldknapp per vy)', () => {
  it('bara Change password är fylld guld; Strava-knapparna är sekundära', () => {
    const primaries = Object.entries(sources).flatMap(([path, text]) => (text.match(/rq-btn--primary/g) ?? []).map(() => path));
    expect(primaries).toEqual(['./components/PasswordCard.tsx']);
  });
});
