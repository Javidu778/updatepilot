import { Router } from 'express';
import { applicationsQuerySchema, type ApplicationsQuery } from '@updatepilot/shared';
import { getOwnedApplication, requireAuth } from '../auth';
import { escapeLike } from '../inventory/search';
import { toApplication, toRelease, toUpdateJob } from '../inventory/serialize';
import { prisma } from '../lib/prisma';
import { noStore } from '../middleware/no-store';
import { getValidated, validate } from '../middleware/validate';
import type { Prisma } from '../../generated/prisma/client';

// A page this far in cannot hold results and would overflow the database's OFFSET.
const MAX_SKIP = 2_000_000_000;
const HISTORY_LIMIT = 20;

/** Mount at /api/v1/applications. */
export function applicationsRouter(): Router {
  const router = Router();
  router.use(noStore);

  // GET /api/v1/applications: search, filter, sort and paginate the user's inventory.
  router.get('/', requireAuth, validate({ query: applicationsQuerySchema }), async (req, res) => {
    const {
      page,
      pageSize,
      q,
      updateStatus,
      matchStatus,
      source,
      deviceId,
      includeRemoved,
      sort,
      order,
    } = getValidated<{ query: ApplicationsQuery }>(res).query;

    // The ownership condition is always part of the query, so another user's data can never match,
    // even if a deviceId that belongs to someone else is passed in.
    const where: Prisma.ApplicationWhereInput = {
      device: { ownerId: req.auth!.user.id },
      ...(deviceId ? { deviceId } : {}),
      ...(includeRemoved ? {} : { removedAt: null }),
      ...(updateStatus ? { updateStatus } : {}),
      ...(matchStatus ? { matchStatus } : {}),
      ...(source ? { source } : {}),
      ...(q
        ? {
            OR: [
              { displayName: { contains: escapeLike(q), mode: 'insensitive' } },
              { publisher: { contains: escapeLike(q), mode: 'insensitive' } },
              { packageId: { contains: escapeLike(q), mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    // `sort` is limited to a fixed list by the schema, so the client can never choose a column.
    // The id tie-breaker keeps the order stable, so paging never repeats or skips a row.
    const orderBy = [
      { [sort]: order },
      { id: 'asc' },
    ] as Prisma.ApplicationOrderByWithRelationInput[];
    const skip = (page - 1) * pageSize;

    const [total, rows] = await Promise.all([
      prisma.application.count({ where }),
      skip > MAX_SKIP ? [] : prisma.application.findMany({ where, orderBy, skip, take: pageSize }),
    ]);

    res.json({
      data: rows.map(toApplication),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  });

  // GET /api/v1/applications/:id: one application with release info and its update history.
  router.get('/:id', requireAuth, async (req, res) => {
    const userId = req.auth!.user.id;
    // 404 for a missing application, an invalid id, and one that belongs to someone else.
    const application = await getOwnedApplication(userId, String(req.params.id));

    const [device, release, jobs] = await Promise.all([
      prisma.device.findUniqueOrThrow({
        where: { id: application.deviceId },
        select: { isSample: true },
      }),
      application.packageId && application.availableVersion
        ? prisma.releaseMetadata.findFirst({
            where: { packageId: application.packageId, version: application.availableVersion },
            orderBy: { fetchedAt: 'desc' },
          })
        : null,
      prisma.updateJob.findMany({
        where: { applicationId: application.id },
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
        take: HISTORY_LIMIT,
      }),
    ]);

    res.json({
      ...toApplication(application),
      isSample: device.isSample,
      release: toRelease(release),
      updateHistory: jobs.map(toUpdateJob),
    });
  });

  return router;
}
