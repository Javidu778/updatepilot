import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import { AppError } from '../lib/errors';

export type RateLimiterOptions = {
  windowMs: number;
  limit: number;
  /** Do not count requests that succeeded. Used for login so the real owner is never locked out. */
  skipSuccessfulRequests?: boolean;
  /** Custom key. The default is the client IP address. */
  key?: (req: Request) => string;
};

export function createRateLimiter(options: RateLimiterOptions) {
  const { key } = options;
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(options.skipSuccessfulRequests ? { skipSuccessfulRequests: true } : {}),
    ...(key ? { keyGenerator: (req: Request) => key(req) } : {}),
    // Reuse the common error format. The library adds the Retry-After header.
    handler: (_req, _res, next) =>
      next(new AppError('RATE_LIMITED', 'Too many requests. Try again shortly.')),
  });
}
