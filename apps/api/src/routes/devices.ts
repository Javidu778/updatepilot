import { Router } from 'express';
import { pairRequestSchema } from '@updatepilot/shared';
import type { z } from 'zod';
import { csrfProtection, getAuthConfig, getOwnedDevice, requireAuth, writeAudit } from '../auth';
import {
  DEFAULT_POLL_INTERVAL_SECONDS,
  generateAgentToken,
  generatePairingCode,
  hashAgentToken,
  hashPairingCode,
  pairingCodeExpiry,
} from '../devices/pairing';
import { toDevice } from '../inventory/serialize';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { noStore } from '../middleware/no-store';
import { createRateLimiter } from '../middleware/rate-limit';
import { getValidated, validate } from '../middleware/validate';

type PairBody = z.infer<typeof pairRequestSchema>;

/** One answer for unknown, used and expired codes, so guessing learns nothing. */
const invalidCode = () => new AppError('NOT_FOUND', 'That pairing code is not valid.');

/** Mount at /api/v1/devices. */
export function devicesRouter(): Router {
  const router = Router();
  router.use(noStore);

  // GET /api/v1/devices: the signed-in user's devices.
  router.get('/', requireAuth, async (req, res) => {
    const rows = await prisma.device.findMany({
      where: { ownerId: req.auth!.user.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const now = new Date();
    res.json({ data: rows.map((row) => toDevice(row, now)) });
  });

  // POST /api/v1/devices/pairing-codes: the browser asks for a code to type into the agent.
  router.post(
    '/pairing-codes',
    requireAuth,
    csrfProtection,
    createRateLimiter({
      windowMs: 60 * 60 * 1000,
      limit: 10,
      key: (req) => `pairing-code:${req.auth?.user.id ?? 'unknown'}`,
    }),
    async (req, res) => {
      const userId = req.auth!.user.id;
      const code = generatePairingCode();
      const expiresAt = pairingCodeExpiry();

      await prisma.pairingCode.create({
        data: {
          userId,
          codeHash: hashPairingCode(code, getAuthConfig().sessionSecret),
          expiresAt,
        },
      });

      await writeAudit(
        {
          actorType: 'USER',
          actorUserId: userId,
          eventType: 'DEVICE_PAIRING_CODE_CREATED',
          targetType: 'pairing_code',
          metadata: { expiresAt: expiresAt.toISOString() },
        },
        req.log,
      );

      // The raw code is returned here and never again.
      res.status(201).json({ code, expiresAt: expiresAt.toISOString() });
    },
  );

  // POST /api/v1/devices/pair: the agent exchanges a code for its own credential.
  // No session and no CSRF token: the agent has neither. The one-time code is the credential.
  router.post(
    '/pair',
    createRateLimiter({ windowMs: 10 * 60 * 1000, limit: 20, skipSuccessfulRequests: true }),
    validate({ body: pairRequestSchema }),
    async (req, res) => {
      const { pairingCode, deviceName, osVersion, agentVersion } = getValidated<{
        body: PairBody;
      }>(res).body;

      const now = new Date();
      const record = await prisma.pairingCode.findUnique({
        where: { codeHash: hashPairingCode(pairingCode, getAuthConfig().sessionSecret) },
      });

      if (!record || record.usedAt !== null || record.expiresAt <= now) throw invalidCode();

      const agentToken = generateAgentToken();

      const device = await prisma.$transaction(async (tx) => {
        // Atomic claim: if two agents race the same code, only one updates a row.
        const claimed = await tx.pairingCode.updateMany({
          where: { id: record.id, usedAt: null },
          data: { usedAt: now },
        });
        if (claimed.count === 0) throw invalidCode();

        const created = await tx.device.create({
          data: {
            ownerId: record.userId,
            name: deviceName,
            osVersion: osVersion ?? null,
            agentVersion: agentVersion ?? null,
            status: 'ACTIVE',
          },
        });

        await tx.agentCredential.create({
          data: { deviceId: created.id, tokenHash: hashAgentToken(agentToken) },
        });

        await tx.pairingCode.update({
          where: { id: record.id },
          data: { deviceId: created.id },
        });

        return created;
      });

      await writeAudit(
        {
          actorType: 'AGENT',
          deviceId: device.id,
          eventType: 'DEVICE_PAIRED',
          targetType: 'device',
          targetId: device.id,
          metadata: { agentVersion: agentVersion ?? null, deviceName },
        },
        req.log,
      );

      res.status(201).json({
        deviceId: device.id,
        agentToken,
        pollIntervalSeconds: DEFAULT_POLL_INTERVAL_SECONDS,
      });
    },
  );

  // POST /api/v1/devices/:id/revoke: stop trusting this device and its agent.
  router.post('/:id/revoke', requireAuth, csrfProtection, async (req, res) => {
    const userId = req.auth!.user.id;
    // 404 for a missing device, an invalid id and another user's device alike.
    const device = await getOwnedDevice(userId, String(req.params.id));
    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      // Every credential for the device is revoked, so a stolen token stops working immediately.
      await tx.agentCredential.updateMany({
        where: { deviceId: device.id, revokedAt: null },
        data: { revokedAt: now },
      });

      return tx.device.update({
        where: { id: device.id },
        data: { status: 'REVOKED' },
      });
    });

    await writeAudit(
      {
        actorType: 'USER',
        actorUserId: userId,
        deviceId: device.id,
        eventType: 'DEVICE_REVOKED',
        targetType: 'device',
        targetId: device.id,
      },
      req.log,
    );

    res.json(toDevice(updated, now));
  });

  return router;
}
