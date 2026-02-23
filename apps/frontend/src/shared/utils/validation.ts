/** Returns an error message if the password is invalid, or null if valid. */
export function validatePassword(password: string): string | null {
  if (password.length < 6) return 'Password must be at least 6 characters';
  return null;
}
