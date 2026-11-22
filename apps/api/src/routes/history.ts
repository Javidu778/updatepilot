import { Router } from 'express';
import {
  historyItemSchema,
  historyQuerySchema,
  type AuditEventType,
  type HistoryQuery,
} from '@updatepilot/shared';
import type { z } from 'zod';
import { requireAuth } from '../auth';
import { ACTIVITY_SUMMARY, HIDDEN_FROM_ACTIVITY } from '../inventory/serialize';
import { prisma } from '../lib/prisma';
import { noStore } from '../middleware/no-store';
import { getValidated, validate } from '../middleware/validate';
import type { Prisma } from '../../generated/prisma/client';

type HistoryItem = z.infer<typeof historyItemSchema>;

const MAX_SKIP = 2_000_000_000;

/** A shared window for the timestamp filter, built once per request. */
function rangeFilter(from: string | undefined, to: string | undefined) {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: new Date(from) } : {}),
    ...(to ? { lte: new Date(to) } : {}),
  };
}

/**
 * One timeline, three sources.
 *
 * `type` picks which source: an update job, a scan job, or an audit event. They are not merged into
 * a single stream on purpose - a merged stream cannot be paged correctly without reading everything,
 * and the History page lets the user choose what they are looking at.
 *
 * Every source is scoped to the signed-in user's own devices and actions.
 */
export function historyRouter(): Router {
  const router = Router();
  router.use(noStore);

  router.get('/', requireAuth, validate({ query: historyQuerySchema }), async (req, res) => {
    const { page, pageSize, type, from, to, outcome, deviceId } = getValidated<{
      query: HistoryQuery;
    }>(res).query;
    const userId = req.auth!.user.id;
    const skip = (page - 1) * pageSize;
    const createdAt = rangeFilter(from, to);

    const paginate = <T>(count: Promise<number>, rows: Promise<T[]>) =>
      Promise.all([count, rows]).then(([total, data]) => ({
        data,
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      }));

    if (type === 'update') {
      const where: Prisma.UpdateJobWhereInput = {
        device: { ownerId: userId },
        ...(deviceId ? { deviceId } : {}),
        ...(outcome ? { state: outcome } : {}),
        ...(createdAt ? { createdAt } : {}),
      };

      const result = await paginate(
        prisma.updateJob.count({ where }),
        skip > MAX_SKIP
          ? Promise.resolve([])
          : prisma.updateJob.findMany({
              where,
              orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
              skip,
              take: pageSize,
              include: { application: { select: { displayName: true } } },
            }),
      );

      const data: HistoryItem[] = result.data.map((job) => ({
        id: job.id,
        type: 'update' as const,
        timestamp: (job.finishedAt ?? job.requestedAt).toISOString(),
        deviceId: job.deviceId,
        outcome: job.state,
        actorType: job.initiatedById ? 'USER' : null,
        summary: `${job.application.displayName}: ${job.fromVersion} → ${job.targetVersion}`,
        details: {
          packageId: job.packageId,
          fromVersion: job.fromVersion,
          targetVersion: job.targetVersion,
          verifiedVersion: job.verifiedVersion,
          verification: job.verification,
          exitCode: job.exitCode,
          restartRequired: job.restartRequired,
          errorSummary: job.errorSummary,
        },
      }));

      res.json({ ...result, data });
      return;
    }

    if (type === 'scan') {
      const where: Prisma.ScanJobWhereInput = {
        device: { ownerId: userId },
        ...(deviceId ? { deviceId } : {}),
        ...(outcome ? { state: outcome } : {}),
        ...(createdAt ? { createdAt } : {}),
      };

      const result = await paginate(
        prisma.scanJob.count({ where }),
        skip > MAX_SKIP
          ? Promise.resolve([])
          : prisma.scanJob.findMany({
              where,
              orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
              skip,
              take: pageSize,
            }),
      );

      const data: HistoryItem[] = result.data.map((job) => ({
        id: job.id,
        type: 'scan' as const,
        timestamp: (job.finishedAt ?? job.createdAt).toISOString(),
        deviceId: job.deviceId,
        outcome: job.state,
        actorType: job.requestedById ? 'USER' : null,
        summary:
          job.state === 'SUCCEEDED'
            ? `Scan found ${job.appCount ?? 0} applications`
            : `Scan ${job.state.toLowerCase()}`,
        details: { appCount: job.appCount, errorSummary: job.errorSummary },
      }));

      res.json({ ...result, data });
      return;
    }

    // type === 'audit'
    const where: Prisma.AuditEventWhereInput = {
      eventType: { notIn: HIDDEN_FROM_ACTIVITY },
      OR: [{ device: { ownerId: userId } }, { actorUserId: userId }],
      ...(deviceId ? { deviceId } : {}),
      ...(createdAt ? { createdAt } : {}),
    };

    const result = await paginate(
      prisma.auditEvent.count({ where }),
      skip > MAX_SKIP
        ? Promise.resolve([])
        : prisma.auditEvent.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip,
            take: pageSize,
          }),
    );

    const data: HistoryItem[] = result.data.map((event) => ({
      id: event.id,
      type: 'audit' as const,
      timestamp: event.createdAt.toISOString(),
      deviceId: event.deviceId,
      outcome: null,
      actorType: event.actorType,
      summary: ACTIVITY_SUMMARY[event.eventType as AuditEventType] ?? event.eventType,
      details: {
        eventType: event.eventType,
        targetType: event.targetType,
        targetId: event.targetId,
        ...(typeof event.metadata === 'object' && event.metadata !== null
          ? (event.metadata as Record<string, unknown>)
          : {}),
      },
    }));

    res.json({ ...result, data });
  });

  return router;
}
