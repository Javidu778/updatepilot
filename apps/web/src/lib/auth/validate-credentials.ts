import { loginRequestSchema, registerRequestSchema } from '@updatepilot/shared';

export type CredentialErrors = { email?: string; password?: string };
type Values = { email: string; password: string };

function emailMessage(value: string, code: string): string {
  if (value.trim() === '') return 'Enter your email address.';
  if (code === 'too_big') return 'That email address is too long.';
  return 'Enter a valid email address.';
}

function passwordMessage(value: string, code: string): string {
  if (value === '') return 'Enter your password.';
  if (code === 'too_big') return 'Use 128 characters or fewer.';
  return 'Use at least 12 characters.';
}

/**
 * Checks the form against the SAME rules the API enforces (the shared Zod schemas), so the
 * two cannot drift apart, and turns each failure into a short message a person can act on.
 */
export function validateCredentials(mode: 'login' | 'register', values: Values): CredentialErrors {
  const schema = mode === 'login' ? loginRequestSchema : registerRequestSchema;
  const result = schema.safeParse({ email: values.email.trim(), password: values.password });
  if (result.success) return {};

  const errors: CredentialErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (field === 'email' && !errors.email) errors.email = emailMessage(values.email, issue.code);
    if (field === 'password' && !errors.password) {
      errors.password = passwordMessage(values.password, issue.code);
    }
  }
  return errors;
}
