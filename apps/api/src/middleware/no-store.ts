import type { RequestHandler } from 'express';

/** Private, per-user data must never be kept by browsers or proxies. */
export const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};
