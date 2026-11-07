import type { CookieOptions } from 'express';
import { prisma } from '../lib/prisma';
import { getAuthConfig } from './config';
import { generateSessionToken, hashSessionToken } from './tokens';
import type { AuthUser } from './types';

const TOUCH_INTERVAL_MS = 60_000;

export function sessionCookieOptions(): CookieOptions {
  const cfg = getAuthConfig();
  return {
    httpOnly: true, // not readable by JavaScript, limits damage from XSS
    secure: cfg.isProduction, // HTTPS only in production (localhost dev runs on http)
    sameSite: 'lax', // not sent on cross-site POSTs
    path: '/',
  };
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const cfg = getAuthConfig();
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + cfg.sessionTtlMs);
  await prisma.session.create({ data: { userId, tokenHash: hashSessionToken(token), expiresAt } });
  return { token, expiresAt };
}

export type FoundSession = { sessionId: string; tokenHash: string; user: AuthUser };

/** Returns the session for a cookie token, or null if it is unknown or expired. */
export async function findSession(token: string): Promise<FoundSession | null> {
  const tokenHash = hashSessionToken(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, email: true, createdAt: true } } },
  });
  if (!session) return null;

  const now = Date.now();
  if (session.expiresAt.getTime() <= now) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  if (now - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    // Best effort. A failed touch must not fail the request.
    void prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date(now) } }).catch(() => undefined);
  }
  return { sessionId: session.id, tokenHash, user: session.user };
}

export async function deleteSessionById(sessionId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

export async function deleteSessionByToken(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
}

export async function deleteExpiredSessions(): Promise<void> {
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
