// 🛡️ Error Type Guards and Utilities
// Provides consistent error handling and type safety throughout the application

import { log } from '@/shared/utils/logger';

/**
 * Type guard to check if error is an Error instance
 */
export function isError(error: unknown): error is Error {
  return error instanceof Error;
}

/**
 * Type guard to check if error is an AbortError
 */
export function isAbortError(error: unknown): error is Error & { name: 'AbortError' } {
  return isError(error) && error.name === 'AbortError';
}

/**
 * Type guard to check if error is a Supabase error
 */
export function isSupabaseError(error: unknown): error is { message: string; code?: string } {
  return typeof error === 'object' &&
         error !== null &&
         'message' in error &&
         typeof (error as Record<string, unknown>).message === 'string';
}

/**
 * Type guard to check if error is a fetch/network error
 */
export function isNetworkError(error: unknown): error is Error & { name: 'TypeError' | 'NetworkError' } {
  return isError(error) && (error.name === 'TypeError' || error.name === 'NetworkError');
}

/**
 * Extract error message with type safety
 */
export function getErrorMessage(error: unknown): string {
  if (isError(error)) {
    return error.message;
  }

  if (isSupabaseError(error)) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>;
    if ('message' in obj && typeof obj.message === 'string') {
      return obj.message;
    }
    if ('error' in obj && typeof obj.error === 'string') {
      return obj.error;
    }
  }

  return 'Unknown error occurred';
}

/**
 * Enhanced error handler with context and type safety
 */
export function handleError(error: unknown, context: string): string {
  log.error(`Error in ${context}`, error);

  if (isAbortError(error)) {
    return `${context} was cancelled`;
  }

  if (isNetworkError(error)) {
    return `Network error in ${context}`;
  }

  if (isSupabaseError(error)) {
    return `Database error in ${context}: ${error.message}`;
  }

  return `${context} failed: ${getErrorMessage(error)}`;
}

/**
 * Async error wrapper with type safety
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  context: string
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    const data = await operation();
    return { success: true, data };
  } catch (error) {
    const errorMessage = handleError(error, context);
    return { success: false, error: errorMessage };
  }
}

/**
 * Error boundary for React components (utility types)
 */
export interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  errorInfo?: string;
}
