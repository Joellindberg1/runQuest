// 🛡️ Backend Error Type Guards and Utilities
// Provides consistent error handling and type safety for backend operations

/**
 * Type guard to check if error is an Error instance
 */
export function isError(error: unknown): error is Error {
  return error instanceof Error;
}

/**
 * Type guard to check if error is a Supabase error
 */
export function isSupabaseError(error: unknown): error is { message: string; code?: string; details?: string } {
  return typeof error === 'object' && 
         error !== null && 
         'message' in error && 
         typeof (error as any).message === 'string';
}

/**
 * Type guard to check if error is a validation error
 */
export function isValidationError(error: unknown): error is { name: 'ValidationError'; errors: string[] } {
  return typeof error === 'object' && 
         error !== null && 
         'name' in error && 
         (error as any).name === 'ValidationError';
}

/**
 * Extract error message with type safety
 */
export function getErrorMessage(error: unknown): string {
  if (isError(error)) {
    return error.message;
  }
  
  if (isSupabaseError(error)) {
    return error.details ? `${error.message}: ${error.details}` : error.message;
  }
  
  if (typeof error === 'string') {
    return error;
  }
  
  if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>;
    if ('message' in obj && typeof obj.message === 'string') {
      return obj.message;
    }
  }
  
  return 'Unknown error occurred';
}

/**
 * Enhanced error handler for backend operations
 */
export function handleBackendError(error: unknown, context: string): {
  status: number;
  message: string;
  code?: string;
} {
  console.error(`❌ Backend error in ${context}:`, error);
  
  if (isSupabaseError(error)) {
    // Map common Supabase errors to HTTP status codes
    const status = error.code === 'PGRST116' ? 404 : // Not found
                   error.code?.startsWith('23') ? 409 : // Constraint violation
                   400; // Bad request for other DB errors
    
    return {
      status,
      message: error.message,
      code: error.code
    };
  }
  
  if (isValidationError(error)) {
    return {
      status: 400,
      message: `Validation failed: ${error.errors.join(', ')}`
    };
  }
  
  if (isError(error)) {
    // Map common Node.js errors
    if (error.name === 'TypeError') {
      return { status: 400, message: 'Invalid input data' };
    }
    if (error.name === 'ReferenceError') {
      return { status: 500, message: 'Server configuration error' };
    }
  }
  
  return {
    status: 500,
    message: `Internal server error in ${context}: ${getErrorMessage(error)}`
  };
}

/**
 * Async error wrapper for backend operations
 */
export async function withBackendErrorHandling<T>(
  operation: () => Promise<T>,
  context: string
): Promise<{ success: true; data: T } | { success: false; error: ReturnType<typeof handleBackendError> }> {
  try {
    const data = await operation();
    return { success: true, data };
  } catch (error) {
    const errorDetails = handleBackendError(error, context);
    return { success: false, error: errorDetails };
  }
}

/**
 * Console error with consistent formatting for backend
 */
export function logBackendError(context: string, error: unknown, requestInfo?: {
  method?: string;
  url?: string;
  userId?: string;
}): void {
  console.group(`❌ Backend Error in ${context}`);
  console.error('Error:', error);
  if (requestInfo) {
    console.table(requestInfo);
  }
  if (isError(error)) {
    console.error('Stack:', error.stack);
  }
  console.groupEnd();
}