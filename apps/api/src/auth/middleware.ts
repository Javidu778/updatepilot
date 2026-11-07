import cookieParser from 'cookie-parser';
import type { RequestHandler } from 'express';
import { forbidden, unauthenticated } from './errors';
import { getAuthConfig } from './config';
import { findSession, sessionCookieOptions } from './session';
import { csrfTokenFor, safeEqual } from './tokens';
import './types';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const parseCookies = cookieParser();

/** Makes sure req.cookies exists even if the app did not install cookie-parser globally. */
function ensureCookies(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]): Promise<void> {
  if (req.cookies) return Promise.resolve();
  return new Promise((resolve) => parseCookies(req, res, () => resolve()));
}

/** Requires a valid login session. Sets req.auth. Use on every protected route. */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const cfg = getAuthConfig();
  await ensureCookies(req, res);

  const token: unknown = req.cookies?.[cfg.cookieName];
  if (typeof token !== 'string' || token.length === 0 || token.length > 200) {
    throw unauthenticated();
  }

  const found = await findSession(token);
  if (!found) {
    res.clearCookie(cfg.cookieName, sessionCookieOptions());
    throw unauthenticated();
  }

  req.auth = {
    user: found.user,
    sessionId: found.sessionId,
    csrfToken: csrfTokenFor(found.tokenHash, cfg.sessionSecret),
  };
  next();
};

/**
 * CSRF protection for cookie-authenticated, state-changing requests.
 * Must run AFTER requireAuth. The client sends the token it received from
 * login/register/me in the X-CSRF-Token header.
 */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  if (!req.auth) {
    next(unauthenticated());
    return;
  }
  const header = req.get('x-csrf-token');
  if (!header || !safeEqual(header, req.auth.csrfToken)) {
    next(forbidden('Missing or invalid CSRF token'));
    return;
  }
  next();
};

/**
 * Defense in depth: a browser always tells us where a cross-origin request came from.
 * If an Origin header is present it must be our web app. In production it is required.
 * Non-browser clients (curl, tests) send no Origin and are still subject to the CSRF token.
 */
export const originCheck: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  const cfg = getAuthConfig();
  const origin = req.get('origin');
  if (origin === undefined) {
    if (cfg.isProduction) {
      next(forbidden('Origin header required'));
      return;
    }
    next();
    return;
  }
  if (origin !== cfg.webOrigin) {
    next(forbidden('Origin not allowed'));
    return;
  }
  next();
};
