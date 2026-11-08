import { Router } from 'express';
import type { Dashboard } from '@updatepilot/shared';
import { requireAuth } from '../auth';
import { connectionState } from '../inventory/connection';
import { ACTIVITY_SUMMARY, HIDDEN_FROM_ACTIVITY } from '../inventory/serialize';
import { prisma } from '../lib/prisma';
import { noStore } from '../middleware/no-store';

const ACTIVITY_LIMIT = 10;

/** Mount at /api/v1/dashboard. */
export function dashboardRouter(): Router {
  const router = Router();
  router.use(noStore);

  // GET /api/v1/dashboard: the numbers for the Overview page, across all of the user's devices.
  router.get('/', requireAuth, async (req, res) => {
    const userId = req.auth!.user.id;
    const now = new Date();

    const devices = await prisma.device.findMany({
      where: { ownerId: userId },
      select: { id: true, status: true, lastSeenAt: true, isSample: true },
    });
    const deviceIds = devices.map((device) => device.id);

    const [groups, lastScan, events] = await Promise.all([
      // One grouped query gives every count. Removed applications are not counted.
      prisma.application.groupBy({
        by: ['matchStatus', 'updateStatus'],
        where: { deviceId: { in: deviceIds }, removedAt: null },
        _count: { _all: true },
      }),
      prisma.scanJob.aggregate({
        where: { deviceId: { in: deviceIds }, state: 'SUCCEEDED' },
        _max: { finishedAt: true },
      }),
      prisma.auditEvent.findMany({
        where: {
          eventType: { notIn: HIDDEN_FROM_ACTIVITY },
          OR: [{ deviceId: { in: deviceIds } }, { actorUserId: userId }],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: ACTIVITY_LIMIT,
      }),
    ]);

    const counts = { applications: 0, updatesAvailable: 0, unmatched: 0, unsupported: 0 };
    for (const group of groups) {
      const n = group._count._all;
      counts.applications += n;
      if (group.updateStatus === 'UPDATE_AVAILABLE') counts.updatesAvailable += n;
      if (group.matchStatus === 'UNMATCHED') counts.unmatched += n;
      if (group.matchStatus === 'UNSUPPORTED') counts.unsupported += n;
    }

    // The agent card shows the most recently seen device that has not been revoked.
    const candidates = devices.filter((device) => device.status !== 'REVOKED');
    const pool = candidates.length > 0 ? candidates : devices;
    const primary = [...pool].sort(
      (a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0),
    )[0];

    const body: Dashboard = {
      // True if any sample device is included, so the UI shows the "Sample data" banner.
      isSample: devices.some((device) => device.isSample),
      counts,
      lastScanAt: lastScan._max.finishedAt ? lastScan._max.finishedAt.toISOString() : null,
      agent: primary
        ? {
            // "pending" with no device means no agent has been paired yet.
            connection: connectionState(primary, now),
            deviceId: primary.id,
            lastSeenAt: primary.lastSeenAt ? primary.lastSeenAt.toISOString() : null,
          }
        : { connection: 'pending', deviceId: null, lastSeenAt: null },
      recentActivity: events.map((event) => ({
        id: event.id,
        timestamp: event.createdAt.toISOString(),
        eventType: event.eventType,
        summary: ACTIVITY_SUMMARY[event.eventType],
      })),
    };
    res.json(body);
  });

  return router;
}
