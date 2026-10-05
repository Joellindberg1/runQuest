import { defineDesignGuards } from '@/test/designGuards';

const sources = import.meta.glob(['./*.{ts,tsx}', '!./*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

defineDesignGuards({
  name: 'Formulärkitet',
  baseUrl: import.meta.url,
  sources,
  cssFiles: ['./form.css'],
  localVars: ['--rq-form-gap'],
});
