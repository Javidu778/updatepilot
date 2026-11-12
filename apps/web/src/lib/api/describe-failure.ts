import { ApiError, NetworkError, ResponseShapeError } from './errors';

/**
 * Turns a failed API call into one sentence a user can act on.
 *
 * Same rules as the sign-in form: no raw server messages except on 4xx answers the server wrote
 * for a person to read, and never anything about whether a record exists for someone else.
 */
export function describeFailure(error: unknown, subject = 'this page'): string {
  if (error instanceof NetworkError) {
    return "We can't reach the server. Check that the API is running, then try again.";
  }

  if (error instanceof ResponseShapeError) {
    return 'The server sent an answer this page does not understand. Reload to try again.';
  }

  if (error instanceof ApiError) {
    if (error.status === 401) return 'Your session ended. Sign in again to continue.';
    if (error.status === 403) return 'The server refused this request. Reload and sign in again.';
    if (error.status === 404) return `We could not find ${subject}.`;
    if (error.status === 429) return 'Too many requests. Wait a moment, then try again.';
    if (error.status >= 500) return 'The server had a problem. Try again in a moment.';
    return error.message;
  }

  return `Something went wrong loading ${subject}. Try again.`;
}
