import { PASSWORD_MIN_LENGTH } from '@runquest/shared';

/** Returns an error message if the password is invalid, or null if valid. */
export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  return null;
}
