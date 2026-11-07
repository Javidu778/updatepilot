import cookieParser from 'cookie-parser';
import { Router } from 'express';
import { loginRequestSchema, registerRequestSchema, type AuthResponse } from '@updatepilot/shared';
import type { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { getValidated, validate } from '../middleware/validate';
import { createRateLimiter } from '../middleware/rate-limit';
import { writeAudit } from './audit';
import { getAuthConfig } from './config';
import { unauthenticated } from './errors';
import { csrfProtection, originCheck, requireAuth } from './middleware';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password';
import { emailKey } from './rate-limit';
import { createSession, deleteExpiredSessions, deleteSessionById, deleteSessionByToken, sessionCookieOptions } from './session';
import { csrfTokenFor, hashSessionToken } from './tokens';
import type { AuthUser } from './types';

export type AuthRouterOptions = {
  /** Failed-login limit per IP per window. Default 20. */
  loginIpLimit?: number;
  /** Failed-login limit per email per window. Default 5. */
  loginEmailLimit?: number;
  /** Registrations per IP per hour. Default 10. */
  registerLimit?: number;
  /** Window for the login limiters, in ms. Default 15 minutes. */
  windowMs?: number;
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

function toResponse(user: AuthUser, csrfToken: string): AuthResponse {
  return { user: { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() }, csrfToken };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}

type RegisterBody = z.infer<typeof registerRequestSchema>;
type LoginBody = z.infer<typeof loginRequestSchema>;

/**
 * Mount at /api/v1/auth, AFTER the app's global express.json() parser
 * (the routes read req.body and the rate limiter reads the submitted email).
 */
export function createAuthRouter(options: AuthRouterOptions = {}): Router {
  const cfg = getAuthConfig(); // fail fast if SESSION_SECRET is missing
  const windowMs = options.windowMs ?? 15 * 60 * 1000;

  const loginIpLimiter = createRateLimiter({ windowMs, limit: options.loginIpLimit ?? 20, skipSuccessfulRequests: true });
  const loginEmailLimiter = createRateLimiter({
    windowMs,
    limit: options.loginEmailLimit ?? 5,
    skipSuccessfulRequests: true,
    key: emailKey,
  });
  const registerLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, limit: options.registerLimit ?? 10 });

  const router = Router();
  router.use(cookieParser());
  router.use(originCheck);

  router.post('/register', registerLimiter, validate({ body: registerRequestSchema }), async (req, res) => {
    const body = getValidated<{ body: RegisterBody }>(res).body;
    const passwordHash = await hashPassword(body.password);

    let user: AuthUser;
    try {
      user = await prisma.user.create({
        data: { email: normalizeEmail(body.email), passwordHash },
        select: { id: true, email: true, createdAt: true },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Deliberately vague so the form cannot be used to find out who has an account.
        throw new AppError('VALIDATION_ERROR', 'Registration failed', [
          { path: 'email', message: 'This email cannot be used' },
        ]);
      }
      throw err;
    }

    const { token, expiresAt } = await createSession(user.id);
    res.cookie(cfg.cookieName, token, { ...sessionCookieOptions(), expires: expiresAt });
    await writeAudit({ actorType: 'USER', actorUserId: user.id, eventType: 'USER_REGISTERED', targetType: 'User', targetId: user.id }, req.log);

    res.status(201).json(toResponse(user, csrfTokenFor(hashSessionToken(token), cfg.sessionSecret)));
  });

  router.post('/login', loginIpLimiter, loginEmailLimiter, validate({ body: loginRequestSchema }), async (req, res) => {
    const body = getValidated<{ body: LoginBody }>(res).body;
    const user = await prisma.user.findUnique({
      where: { email: normalizeEmail(body.email) },
      select: { id: true, email: true, createdAt: true, passwordHash: true },
    });

    // Same work and same message whether the email exists or not.
    const valid = user ? await verifyPassword(body.password, user.passwordHash) : await verifyAgainstDummy(body.password);
    if (!user || !valid) {
      await writeAudit(
        {
          actorType: 'USER',
          actorUserId: user?.id ?? null,
          eventType: 'UNAUTHORIZED_ATTEMPT',
          targetType: 'login',
          metadata: { reason: 'bad_credentials' },
        },
        req.log,
      );
      throw unauthenticated('Invalid email or password');
    }

    // New session on every login. Drop the one this browser already had.
    const previous: unknown = req.cookies?.[cfg.cookieName];
    if (typeof previous === 'string' && previous.length > 0 && previous.length <= 200) {
      await deleteSessionByToken(previous);
    }
    await deleteExpiredSessions();

    const { token, expiresAt } = await createSession(user.id);
    res.cookie(cfg.cookieName, token, { ...sessionCookieOptions(), expires: expiresAt });
    await writeAudit({ actorType: 'USER', actorUserId: user.id, eventType: 'USER_LOGIN', targetType: 'User', targetId: user.id }, req.log);

    res.json(toResponse(user, csrfTokenFor(hashSessionToken(token), cfg.sessionSecret)));
  });

  router.post('/logout', requireAuth, csrfProtection, async (req, res) => {
    const auth = req.auth!;
    await deleteSessionById(auth.sessionId);
    res.clearCookie(cfg.cookieName, sessionCookieOptions());
    await writeAudit({ actorType: 'USER', actorUserId: auth.user.id, eventType: 'USER_LOGOUT', targetType: 'User', targetId: auth.user.id }, req.log);
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req, res) => {
    const auth = req.auth!;
    res.json(toResponse(auth.user, auth.csrfToken));
  });

  return router;
}
