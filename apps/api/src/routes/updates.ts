import { Router } from 'express';
import {
  updatePreviewSchema,
  updatesQuerySchema,
  type UpdateCandidate,
  type UpdatePreview,
  type UpdatesQuery,
} from '@updatepilot/shared';
import { csrfProtection, getOwnedApplication, requireAuth } from '../auth';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { noStore } from '../middleware/no-store';
import { getValidated, validate } from '../middleware/validate';
import { createPreviewToken } from '../updates/preview';
import type { Prisma } from '../../generated/prisma/client';

/** An update job in one of these states means the user already has an update in flight. */
const ACTIVE_UPDATE_STATES = ['QUEUED', 'RUNNING', 'VERIFYING'] as const;

const MAX_SKIP = 2_000_000_000;

type ApplicationRow = {
  id: string;
  deviceId: string;
  displayName: string;
  publisher: string | null;
  installedVersion: string;
  availableVersion: string | null;
  packageId: string | null;
  source: string | null;
  architecture: string | null;
};

/**
 * The candidate list only contains applications that can actually be updated: matched, from the
 * winget source, with a newer version known. Everything else stays visible in the inventory, but it
 * is not offered here as something actionable.
 */
function toCandidate(row: ApplicationRow, activeJobId: string | null): UpdateCandidate {
  if (!row.packageId || !row.source || !row.availableVersion) {
    throw new Error('toCandidate called for an application that is not a candidate');
  }
  return {
    applicationId: row.id,
    deviceId: row.deviceId,
    displayName: row.displayName,
    publisher: row.publisher,
    packageId: row.packageId,
    source: row.source,
    installedVersion: row.installedVersion,
    availableVersion: row.availableVersion,
    notes: [],
    activeJobId,
  };
}

/** Mount at /api/v1/updates. */
export function updatesRouter(): Router {
  const router = Router();
  router.use(noStore);

  // GET /api/v1/updates: the applications that have an update available.
  router.get('/', requireAuth, validate({ query: updatesQuerySchema }), async (req, res) => {
    const { page, pageSize, deviceId } = getValidated<{ query: UpdatesQuery }>(res).query;

    const where: Prisma.ApplicationWhereInput = {
      device: { ownerId: req.auth!.user.id },
      removedAt: null,
      updateStatus: 'UPDATE_AVAILABLE',
      packageId: { not: null },
      source: 'winget',
      availableVersion: { not: null },
      ...(deviceId ? { deviceId } : {}),
    };

    const skip = (page - 1) * pageSize;
    const [total, rows] = await Promise.all([
      prisma.application.count({ where }),
      skip > MAX_SKIP
        ? []
        : prisma.application.findMany({
            where,
            orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
            skip,
            take: pageSize,
          }),
    ]);

    // One query for the whole page, so the list cannot go stale row by row.
    const active = await prisma.updateJob.findMany({
      where: {
        applicationId: { in: rows.map((row) => row.id) },
        state: { in: [...ACTIVE_UPDATE_STATES] },
      },
      select: { id: true, applicationId: true },
    });
    const activeByApplication = new Map(active.map((job) => [job.applicationId, job.id]));

    res.json({
      data: rows.map((row) => toCandidate(row, activeByApplication.get(row.id) ?? null)),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  });

  // POST /api/v1/updates/:id/preview: what would happen, and a token that authorises exactly that.
  // {id} is the APPLICATION id.
  router.post('/:id/preview', requireAuth, csrfProtection, async (req, res) => {
    const userId = req.auth!.user.id;
    // 404 for a missing application, an invalid id and another user's application alike.
    const application = await getOwnedApplication(userId, String(req.params.id));

    if (
      !application.packageId ||
      application.source !== 'winget' ||
      !application.availableVersion
    ) {
      throw new AppError(
        'UNSUPPORTED_PACKAGE',
        'This application has no supported update method, so it cannot be updated automatically.',
      );
    }

    if (application.updateStatus !== 'UPDATE_AVAILABLE') {
      throw new AppError('INVALID_STATE', 'This application is already up to date.');
    }

    const active = await prisma.updateJob.findFirst({
      where: { applicationId: application.id, state: { in: [...ACTIVE_UPDATE_STATES] } },
      select: { id: true },
    });
    if (active) {
      throw new AppError('INVALID_STATE', 'An update for this application is already in progress.');
    }

    // Release notes come from the cache only: a preview never waits on a third party.
    const release = await prisma.releaseMetadata.findFirst({
      where: { packageId: application.packageId, version: application.availableVersion },
      orderBy: { fetchedAt: 'desc' },
    });

    const notes: string[] = [];
    if (release) {
      const date = release.releaseDate ? release.releaseDate.toISOString().slice(0, 10) : null;
      notes.push(
        date
          ? `Version ${release.version} was released on ${date}.`
          : `Version ${release.version} is the latest known release.`,
      );
    }
    notes.push('Windows may ask for permission to install this update.');
    notes.push('An update can still ask for a restart when it finishes.');

    const { token, expiresAt } = await createPreviewToken({
      userId,
      applicationId: application.id,
      packageId: application.packageId,
      source: application.source,
      fromVersion: application.installedVersion,
      targetVersion: application.availableVersion,
    });

    const body: UpdatePreview = {
      applicationId: application.id,
      deviceId: application.deviceId,
      displayName: application.displayName,
      publisher: application.publisher,
      packageId: application.packageId,
      source: application.source,
      architecture: application.architecture,
      fromVersion: application.installedVersion,
      targetVersion: application.availableVersion,
      // We cannot know before running it, and saying "no" would be a promise we cannot keep.
      mayRequireElevation: true,
      mayRequireRestart: false,
      notes,
      previewToken: token,
      expiresAt: expiresAt.toISOString(),
    };

    res.json(updatePreviewSchema.parse(body));
  });

  return router;
}
