import type { RequestHandler } from 'express';
import { hashAgentToken } from '../devices/pairing';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import './types';

/** "Bearer <token>". The token is base64url, so the character class is deliberately narrow. */
const BEARER = /^Bearer ([A-Za-z0-9_-]{20,200})$/;

export function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = BEARER.exec(header.trim());
  return match ? match[1] : null;
}

/**
 * Authenticates the Windows agent by its own credential, never by a user session.
 *
 * The 401/403 split is what the agent's error handling depends on (docs/agent-protocol.md §7):
 *   401  the token is unknown, expired or rotated away  -> stop, "credentials invalid"
 *   403  the device was revoked by its owner             -> stop polling, "pair again"
 *
 * The poll doubles as the heartbeat: lastSeenAt is what the dashboard turns into
 * connected / stale / disconnected, so it is written on every authenticated request.
 */
export const authenticateAgent: RequestHandler = async (req, _res, next) => {
  const token = parseBearer(req.get('authorization'));
  if (!token) {
    next(new AppError('UNAUTHENTICATED', 'Agent credentials are missing.'));
    return;
  }

  const now = new Date();
  const credential = await prisma.agentCredential.findUnique({
    where: { tokenHash: hashAgentToken(token) },
    include: { device: true },
  });

  const expired =
    credential?.expiresAt !== null && credential?.expiresAt !== undefined
      ? credential.expiresAt <= now
      : false;

  if (!credential || credential.revokedAt !== null || expired) {
    next(new AppError('UNAUTHENTICATED', 'Agent credentials are invalid.'));
    return;
  }

  if (credential.device.status === 'REVOKED') {
    next(new AppError('FORBIDDEN', 'This device was revoked. Pair it again.'));
    return;
  }

  await prisma.$transaction([
    prisma.agentCredential.update({ where: { id: credential.id }, data: { lastUsedAt: now } }),
    // A device that has never been seen becomes ACTIVE on its first authenticated call.
    prisma.device.update({
      where: { id: credential.deviceId },
      data: { lastSeenAt: now, status: 'ACTIVE' },
    }),
  ]);

  req.agent = { device: credential.device, credential: credential };
  next();
};
