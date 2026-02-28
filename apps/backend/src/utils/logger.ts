/**
 * Structured logger for RunQuest backend.
 *
 * Development : forwards directly to console (preserves emoji, colours, etc.)
 * Production  : emits newline-delimited JSON for Railway log aggregation
 */

const isProd = process.env.NODE_ENV === 'production';

type Meta = unknown;

function emit(level: 'info' | 'warn' | 'error', message: string, ...args: Meta[]) {
  if (isProd) {
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };
    if (args.length === 1) entry.context = args[0];
    else if (args.length > 1) entry.context = args;
    const fn = level === 'info' ? console.log : console[level];
    fn(JSON.stringify(entry));
  } else {
    const fn = level === 'info' ? console.log : console[level];
    fn(message, ...args);
  }
}

export const logger = {
  info:  (message: string, ...args: Meta[]) => emit('info',  message, ...args),
  warn:  (message: string, ...args: Meta[]) => emit('warn',  message, ...args),
  error: (message: string, ...args: Meta[]) => emit('error', message, ...args),
  /** Silent in production — use for verbose dev-only output. */
  debug: (message: string, ...args: Meta[]) => { if (!isProd) emit('info', message, ...args); },
};
