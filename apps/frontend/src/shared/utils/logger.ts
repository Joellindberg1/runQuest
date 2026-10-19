/**
 * Centralized logging utility
 * - Development: All logs visible
 * - Production: Only warnings and errors
 * - Errors are also reported to error tracking (shared/observability) when it is switched on
 */
import { reportError } from '@/shared/observability/errorReporting';

class Logger {
  private isDevelopment = import.meta.env.DEV;

  /**
   * Debug logs - only visible in development
   * Use for detailed debugging information
   */
  debug(message: string, ...args: unknown[]) {
    if (this.isDevelopment) {
      console.log(`🔍 [DEBUG] ${message}`, ...args);
    }
  }

  /**
   * Info logs - only visible in development
   * Use for general information
   */
  info(message: string, ...args: unknown[]) {
    if (this.isDevelopment) {
      console.info(`ℹ️ [INFO] ${message}`, ...args);
    }
  }

  /**
   * Warning logs - visible in both dev and production
   * Use for non-critical issues
   */
  warn(message: string, ...args: unknown[]) {
    console.warn(`⚠️ [WARN] ${message}`, ...args);
  }

  /**
   * Error logs - visible in both dev and production
   * Use for errors and exceptions
   */
  error(message: string, error?: unknown) {
    console.error(`❌ [ERROR] ${message}`, error);
    if (error instanceof Error) {
      reportError(error, { message });
      return;
    }
    // Ett värde som inte är ett Error (svarsobjekt, sträng) får inget eget stackspår; felet byggs ur meddelandet och värdet följer som detalj.
    reportError(new Error(message), error === undefined ? { message } : { message, detail: error });
  }

  /**
   * Success logs - only visible in development
   * Use for successful operations
   */
  success(message: string, ...args: unknown[]) {
    if (this.isDevelopment) {
      console.log(`✅ [SUCCESS] ${message}`, ...args);
    }
  }
}

export const logger = new Logger();
export const log = logger; // Alias for convenience
