/**
 * Centralized logging utility
 * - Development: All logs visible
 * - Production: Only warnings and errors
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  private isDevelopment = import.meta.env.DEV;

  /**
   * Debug logs - only visible in development
   * Use for detailed debugging information
   */
  debug(message: string, ...args: any[]) {
    if (this.isDevelopment) {
      console.log(`🔍 [DEBUG] ${message}`, ...args);
    }
  }

  /**
   * Info logs - only visible in development
   * Use for general information
   */
  info(message: string, ...args: any[]) {
    if (this.isDevelopment) {
      console.info(`ℹ️ [INFO] ${message}`, ...args);
    }
  }

  /**
   * Warning logs - visible in both dev and production
   * Use for non-critical issues
   */
  warn(message: string, ...args: any[]) {
    console.warn(`⚠️ [WARN] ${message}`, ...args);
  }

  /**
   * Error logs - visible in both dev and production
   * Use for errors and exceptions
   */
  error(message: string, error?: any) {
    console.error(`❌ [ERROR] ${message}`, error);
    // Future: Send to error tracking service (Sentry, etc.)
  }

  /**
   * Success logs - only visible in development
   * Use for successful operations
   */
  success(message: string, ...args: any[]) {
    if (this.isDevelopment) {
      console.log(`✅ [SUCCESS] ${message}`, ...args);
    }
  }
}

export const logger = new Logger();
export const log = logger; // Alias for convenience
