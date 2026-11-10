import { ApiError, NetworkError, ResponseShapeError, fieldMessages } from '@/lib/api/errors';
import type { CredentialErrors } from './validate-credentials';

export type DescribedError = { formError: string | null; fieldErrors: CredentialErrors };

function waitText(seconds: number | undefined): string {
  if (!seconds) return 'Wait a few minutes and try again.';
  if (seconds < 90) return 'Try again in a minute.';
  return `Try again in about ${Math.ceil(seconds / 60)} minutes.`;
}

/**
 * Turns whatever went wrong into text for the form. No raw server messages are shown, apart
 * from field details on a 400, and nothing here reveals whether an email has an account.
 */
export function describeAuthError(error: unknown, mode: 'login' | 'register'): DescribedError {
  if (error instanceof NetworkError) {
    return {
      formError: "We can't reach the server. Check that the API is running, then try again.",
      fieldErrors: {},
    };
  }

  if (error instanceof ApiError) {
    if (error.status === 429) {
      return {
        formError: `Too many attempts. ${waitText(error.retryAfterSeconds)}`,
        fieldErrors: {},
      };
    }
    if (error.status === 401) {
      return { formError: 'Incorrect email or password.', fieldErrors: {} };
    }
    if (error.status === 403) {
      return {
        formError: 'The server rejected this request. Reload the page and try again.',
        fieldErrors: {},
      };
    }
    if (error.status === 400) {
      const messages = fieldMessages(error);
      const fieldErrors: CredentialErrors = {};
      if (messages.email) fieldErrors.email = messages.email;
      if (messages.password) fieldErrors.password = messages.password;
      if (fieldErrors.email || fieldErrors.password) return { formError: null, fieldErrors };
      return {
        formError:
          mode === 'register'
            ? 'We could not create the account.'
            : 'Check the details and try again.',
        fieldErrors: {},
      };
    }
    if (error.status >= 500) {
      return {
        formError: 'Something went wrong on our side. Try again in a moment.',
        fieldErrors: {},
      };
    }
  }

  if (error instanceof ResponseShapeError) {
    return { formError: 'The server sent an unexpected answer. Try again later.', fieldErrors: {} };
  }
  return { formError: 'Something went wrong. Try again.', fieldErrors: {} };
}
