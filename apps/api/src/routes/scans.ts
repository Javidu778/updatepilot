import { Router } from 'express';
import { idempotencyKeySchema, type Job } from '@updatepilot/shared';
import { csrfProtection, getOwnedDevice, requireAuth, writeAudit } from '../auth';
import { toScanJob } from '../inventory/scan';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { createRateLimiter } from '../middleware/rate-limit';
import { noStore } from '../middleware/no-store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE_STATES = ['QUEUED', 'RUNNING'] as const;

export type ScansRouterOptions = {
  /** Scan requests per user per hour. Default 30. */
  scanLimit?: number;
};

/** Mount at /api/v1. Holds the user-facing scan routes (the agent's own routes live in agent.ts). */
export function scansRouter(options: ScansRouterOptions = {}): Router {
  const router = Router();
  router.use(noStore);

  // A scan is cheap for us but not for the machine: each one runs WinGet. One user cannot queue
  // them faster than they can be served, so a per-user limit replaces an earlier gap.
  const scanLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    limit: options.scanLimit ?? 30,
    key: (req) => `scan:${req.auth?.user.id ?? 'unknown'}`,
  });

  // POST /api/v1/devices/:id/scans: queue a scan for one of the caller's devices.
  router.post('/devices/:id/scans', requireAuth, csrfProtection, scanLimiter, async (req, res) => {
    const userId = req.auth!.user.id;
    const device = await getOwnedDevice(userId, String(req.params.id));

    if (device.status === 'REVOKED') {
      throw new AppError('DEVICE_REVOKED', 'This device was revoked. Pair it again.');
    }

    const rawKey = req.get('idempotency-key');
    let idempotencyKey: string | null = null;
    if (rawKey) {
      const parsed = idempotencyKeySchema.safeParse(rawKey);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 'Idempotency-Key must be a UUID.');
      }
      idempotencyKey = parsed.data;

      // A retried request returns the job it already created, not a second scan.
      const existing = await prisma.scanJob.findFirst({
        where: { deviceId: device.id, idempotencyKey },
      });
      if (existing) {
        res.status(202).json(toScanJob(existing));
        return;
      }
    }

    const active = await prisma.scanJob.findFirst({
      where: { deviceId: device.id, state: { in: [...ACTIVE_STATES] } },
      select: { id: true },
    });
    if (active) {
      throw new AppError('INVALID_STATE', 'A scan is already queued or running for this device.');
    }

    const job = await prisma.scanJob.create({
      data: { deviceId: device.id, requestedById: userId, idempotencyKey, state: 'QUEUED' },
    });

    await writeAudit(
      {
        actorType: 'USER',
        actorUserId: userId,
        deviceId: device.id,
        eventType: 'SCAN_REQUESTED',
        targetType: 'scan_job',
        targetId: job.id,
      },
      req.log,
    );

    res.status(202).json(toScanJob(job));
  });

  // GET /api/v1/scans/:id: progress for the page that asked for the scan.
  router.get('/scans/:id', requireAuth, async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) throw new AppError('NOT_FOUND', 'That scan does not exist.');

    const job = await prisma.scanJob.findFirst({
      where: { id, device: { ownerId: req.auth!.user.id } },
    });
    if (!job) throw new AppError('NOT_FOUND', 'That scan does not exist.');

    const body: Job = toScanJob(job);
    res.json(body);
  });

  return router;
}
