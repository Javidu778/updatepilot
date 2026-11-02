import rateLimit from 'express-rate-limit';
import { AppError } from '../lib/errors';

export function createRateLimiter(options: { windowMs: number; limit: number }) {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Reuse the common error format. The library adds the Retry-After header.
    handler: (_req, _res, next) =>
      next(new AppError('RATE_LIMITED', 'Too many requests. Try again shortly.')),
  });
}
