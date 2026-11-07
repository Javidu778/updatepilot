import { AppError } from '../lib/errors';

/** Small helpers that create the shell's AppError with the right code. */
export const unauthenticated = (message = 'Authentication required') =>
  new AppError('UNAUTHENTICATED', message);

export const forbidden = (message = 'Forbidden') => new AppError('FORBIDDEN', message);

// Also used when a resource exists but belongs to someone else, so IDs cannot be probed.
export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found`);
