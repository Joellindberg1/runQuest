import { defineDesignGuards } from '@/test/designGuards';

const sources = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '../../pages/AdminPage.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

defineDesignGuards({
  name: 'Admin-filerna',
  baseUrl: import.meta.url,
  sources,
  cssFiles: ['./admin.css'],
  tokenPrefix: '--rq-admin-',
  localVars: ['--rq-edge', '--rq-edge-line', '--rq-form-gap'],
});
