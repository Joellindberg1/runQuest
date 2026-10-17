// Körs som egen process av processHandlers.test.ts: startar Sentry som servern gör och kraschar sedan på avsikt.
import { initSentry } from '../../sentry.js';

initSentry(process.env);

const mode = process.argv[2];
if (mode === 'rejection') {
  Promise.reject(new Error('crash-fixture unhandled rejection'));
} else if (mode === 'exception') {
  setTimeout(() => { throw new Error('crash-fixture uncaught exception'); }, 10);
} else {
  throw new Error(`unknown mode ${mode}`);
}
