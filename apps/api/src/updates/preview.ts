import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma';

/**
 * Preview tokens.
 *
 * A preview shows exactly what will happen: this package, from this version, to that version. The
 * token binds those facts to the user who confirmed them, so the execute call cannot be pointed at
 * something else.
 *
 * The token is 256 random bits, stored only as a SHA-256 hash, and marked used when it is spent.
 * That gives the three properties the threat model asks for without a signing key: it cannot be
 * forged, it expires, and it cannot be replayed.
 */
export const PREVIEW_TTL_MS = 10 * 60 * 1000;

export function generatePreviewToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashPreviewToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createPreviewToken(args: {
  userId: string;
  applicationId: string;
  packageId: string;
  source: string;
  fromVersion: string;
  targetVersion: string;
  now?: Date;
}): Promise<{ token: string; expiresAt: Date }> {
  const now = args.now ?? new Date();
  const token = generatePreviewToken();
  const expiresAt = new Date(now.getTime() + PREVIEW_TTL_MS);

  await prisma.previewToken.create({
    data: {
      tokenHash: hashPreviewToken(token),
      userId: args.userId,
      applicationId: args.applicationId,
      packageId: args.packageId,
      source: args.source,
      fromVersion: args.fromVersion,
      targetVersion: args.targetVersion,
      expiresAt,
    },
  });

  return { token, expiresAt };
}

/**
 * Finds a token that may still be spent: it belongs to this user, has not expired and has not been
 * used. Returns null for anything else, so the caller answers one uniform error.
 */
export async function findSpendablePreviewToken(
  token: string,
  userId: string,
  now: Date = new Date(),
) {
  if (!token || token.length < 20 || token.length > 200) return null;

  return prisma.previewToken.findFirst({
    where: {
      tokenHash: hashPreviewToken(token),
      userId,
      usedAt: null,
      expiresAt: { gt: now },
    },
  });
}
