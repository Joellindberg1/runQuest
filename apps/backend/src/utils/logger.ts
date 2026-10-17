/**
 * Structured logger for RunQuest backend.
 *
 * Development : forwards directly to console (preserves emoji, colours, etc.)
 * Production  : emits newline-delimited JSON for Railway log aggregation
 */

const isProd = process.env.NODE_ENV === 'production';

type Meta = unknown;

const MAX_DEPTH = 8;

/**
 * Gör ett loggvärde JSON-säkert utan att tappa information. JSON.stringify ger `{}` för
 * Error (message/stack är inte enumerable) och kraschar på cirkulära referenser och bigint —
 * i en loggfunktion får det aldrig hända, och just felen är det som måste synas i Railway.
 */
function toSerializable(value: unknown, ancestors: object[] = []): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return String(value);
  if (value === null || typeof value !== 'object') return value;

  if (ancestors.includes(value)) return '[Circular]';
  if (ancestors.length >= MAX_DEPTH) return '[MaxDepth]';
  const path = [...ancestors, value];

  if (Array.isArray(value)) return value.map((item) => toSerializable(item, path));

  const out: Record<string, unknown> = {};
  if (value instanceof Error) {
    // Alltid med: egenskaperna är inte enumerable. PostgrestError-fält (code/details/hint)
    // kommer med via de enumerable egenskaperna nedan.
    out.name = value.name;
    out.message = value.message;
    out.stack = value.stack;
    if ('cause' in value && value.cause !== undefined) out.cause = toSerializable(value.cause, path);
  } else if (typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    return toSerializable((value as { toJSON: () => unknown }).toJSON(), path);
  }
  for (const [key, inner] of Object.entries(value)) {
    if (key in out) continue;
    out[key] = toSerializable(inner, path);
  }
  return out;
}

function stringify(entry: Record<string, unknown>): string {
  try {
    return JSON.stringify(toSerializable(entry));
  } catch {
    // Sista utväg (t.ex. en getter som kastar): raden måste ändå skrivas.
    return JSON.stringify({ timestamp: entry.timestamp, level: entry.level, message: entry.message, context: '[unserializable]' });
  }
}

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
    fn(stringify(entry));
  } else {
    const fn = level === 'info' ? console.log : console[level];
    fn(message, ...args);
  }
}

/**
 * En enda kopplingspunkt för felrapportering (Sentry, observability/sentry.ts): varje anrop till logger.error lämnas hit.
 * Loggern känner inte till Sentry, så den går att importera överallt utan att dra in SDK:t.
 */
export type ErrorSink = (message: string, args: Meta[]) => void;
let errorSink: ErrorSink | null = null;

export function setErrorSink(sink: ErrorSink | null): void {
  errorSink = sink;
}

function reportError(message: string, args: Meta[]) {
  if (!errorSink) return;
  try {
    errorSink(message, args);
  } catch {
    // Felrapporteringen får aldrig stoppa själva loggningen eller anroparen.
  }
}

export const logger = {
  info:  (message: string, ...args: Meta[]) => emit('info',  message, ...args),
  warn:  (message: string, ...args: Meta[]) => emit('warn',  message, ...args),
  error: (message: string, ...args: Meta[]) => { emit('error', message, ...args); reportError(message, args); },
  /** Silent in production — use for verbose dev-only output. */
  debug: (message: string, ...args: Meta[]) => { if (!isProd) emit('info', message, ...args); },
};
