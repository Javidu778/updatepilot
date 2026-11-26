import { Router, type Response } from 'express';
import { applicationsQuerySchema, type ApplicationsQuery } from '@updatepilot/shared';
import { requireAuth, writeAudit } from '../auth';
import { toCsv, type CsvColumn } from '../exports/csv';
import { escapeLike } from '../inventory/search';
import { prisma } from '../lib/prisma';
import { createRateLimiter } from '../middleware/rate-limit';
import { getValidated, validate } from '../middleware/validate';
import type { Prisma } from '../../generated/prisma/client';

/** A cap that keeps a response bounded. The header says when it was hit. */
const MAX_ROWS = 20_000;

type ApplicationRow = {
  displayName: string;
  publisher: string | null;
  installedVersion: string;
  availableVersion: string | null;
  packageId: string | null;
  source: string | null;
  architecture: string | null;
  matchStatus: string;
  updateStatus: string;
  lastSeenAt: Date;
  removedAt: Date | null;
  device: { name: string; isSample: boolean };
};

type UpdateRow = {
  requestedAt: Date;
  finishedAt: Date | null;
  packageId: string;
  fromVersion: string;
  targetVersion: string;
  state: string;
  verification: string;
  verifiedVersion: string | null;
  exitCode: number | null;
  restartRequired: boolean;
  errorSummary: string | null;
  device: { name: string };
  application: { displayName: string };
};

const APPLICATION_COLUMNS: CsvColumn<ApplicationRow>[] = [
  { header: 'Device', value: (row) => row.device.name },
  { header: 'Application', value: (row) => row.displayName },
  { header: 'Publisher', value: (row) => row.publisher },
  { header: 'Installed version', value: (row) => row.installedVersion },
  { header: 'Available version', value: (row) => row.availableVersion },
  { header: 'Package ID', value: (row) => row.packageId },
  { header: 'Source', value: (row) => row.source },
  { header: 'Architecture', value: (row) => row.architecture },
  { header: 'Match status', value: (row) => row.matchStatus },
  { header: 'Update status', value: (row) => row.updateStatus },
  { header: 'Last seen', value: (row) => row.lastSeenAt.toISOString() },
  { header: 'Removed', value: (row) => (row.removedAt ? row.removedAt.toISOString() : '') },
  { header: 'Sample data', value: (row) => row.device.isSample },
];

const UPDATE_COLUMNS: CsvColumn<UpdateRow>[] = [
  { header: 'Requested', value: (row) => row.requestedAt.toISOString() },
  { header: 'Finished', value: (row) => (row.finishedAt ? row.finishedAt.toISOString() : '') },
  { header: 'Device', value: (row) => row.device.name },
  { header: 'Application', value: (row) => row.application.displayName },
  { header: 'Package ID', value: (row) => row.packageId },
  { header: 'From version', value: (row) => row.fromVersion },
  { header: 'To version', value: (row) => row.targetVersion },
  { header: 'State', value: (row) => row.state },
  { header: 'Verification', value: (row) => row.verification },
  { header: 'Verified version', value: (row) => row.verifiedVersion },
  { header: 'Exit code', value: (row) => row.exitCode },
  { header: 'Restart required', value: (row) => row.restartRequired },
  { header: 'Reason', value: (row) => row.errorSummary },
];

/** `attachment; filename="updatepilot-inventory-2026-11-26.csv"` — no user text, so no quoting needed. */
function disposition(kind: string, now: Date): string {
  const day = now.toISOString().slice(0, 10);
  return `attachment; filename="updatepilot-${kind}-${day}.csv"`;
}

/**
 * Mount at /api/v1/exports.
 *
 * Exports are the one endpoint that returns a lot of rows at once, so they are rate limited per
 * user and capped, and every export is written to the audit trail with its row count. The CSV layer
 * neutralises formula characters, because application names come from installed software and end up
 * in somebody's spreadsheet.
 */
export function exportsRouter(): Router {
  const router = Router();

  const exportLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    limit: 20,
    key: (req) => `export:${req.auth?.user.id ?? 'unknown'}`,
  });

  const sendCsv = async (args: {
    res: Response;
    fileNameKind: string;
    body: string;
    rowCount: number;
    truncated: boolean;
    now: Date;
  }) => {
    args.res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    args.res.setHeader('Content-Disposition', disposition(args.fileNameKind, args.now));
    // Private data: never cached by a proxy or the browser.
    args.res.setHeader('Cache-Control', 'no-store');
    if (args.truncated) args.res.setHeader('X-UpdatePilot-Truncated', 'true');
    args.res.setHeader('X-UpdatePilot-Rows', String(args.rowCount));
    args.res.send(args.body);
  };

  // GET /api/v1/exports/applications.csv: the inventory, honouring the same filters as the list.
  router.get(
    '/applications.csv',
    requireAuth,
    exportLimiter,
    validate({ query: applicationsQuerySchema }),
    async (req, res) => {
      const query = getValidated<{ query: ApplicationsQuery }>(res).query;
      const now = new Date();

      const where: Prisma.ApplicationWhereInput = {
        device: { ownerId: req.auth!.user.id },
        ...(query.deviceId ? { deviceId: query.deviceId } : {}),
        ...(query.includeRemoved ? {} : { removedAt: null }),
        ...(query.updateStatus ? { updateStatus: query.updateStatus } : {}),
        ...(query.matchStatus ? { matchStatus: query.matchStatus } : {}),
        ...(query.source ? { source: query.source } : {}),
        ...(query.q
          ? {
              OR: [
                { displayName: { contains: escapeLike(query.q), mode: 'insensitive' } },
                { publisher: { contains: escapeLike(query.q), mode: 'insensitive' } },
                { packageId: { contains: escapeLike(query.q), mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      const rows = await prisma.application.findMany({
        where,
        // The same order the list shows, so the file matches what was on screen.
        orderBy: [
          { [query.sort]: query.order },
          { id: 'asc' },
        ] as Prisma.ApplicationOrderByWithRelationInput[],
        take: MAX_ROWS + 1,
        include: { device: { select: { name: true, isSample: true } } },
      });

      const truncated = rows.length > MAX_ROWS;
      const page = truncated ? rows.slice(0, MAX_ROWS) : rows;

      await writeAudit(
        {
          actorType: 'USER',
          actorUserId: req.auth!.user.id,
          eventType: 'EXPORT_CREATED',
          targetType: 'export',
          metadata: { kind: 'applications', rowCount: page.length, truncated },
        },
        req.log,
      );

      await sendCsv({
        res,
        fileNameKind: 'inventory',
        body: toCsv(page, APPLICATION_COLUMNS),
        rowCount: page.length,
        truncated,
        now,
      });
    },
  );

  // GET /api/v1/exports/updates.csv: the update history, for reporting.
  router.get('/updates.csv', requireAuth, exportLimiter, async (req, res) => {
    const now = new Date();
    const rows = await prisma.updateJob.findMany({
      where: { device: { ownerId: req.auth!.user.id } },
      orderBy: [{ requestedAt: 'desc' }, { id: 'asc' }],
      take: MAX_ROWS + 1,
      include: {
        device: { select: { name: true } },
        application: { select: { displayName: true } },
      },
    });

    const truncated = rows.length > MAX_ROWS;
    const page = truncated ? rows.slice(0, MAX_ROWS) : rows;

    await writeAudit(
      {
        actorType: 'USER',
        actorUserId: req.auth!.user.id,
        eventType: 'EXPORT_CREATED',
        targetType: 'export',
        metadata: { kind: 'updates', rowCount: page.length, truncated },
      },
      req.log,
    );

    await sendCsv({
      res,
      fileNameKind: 'updates',
      body: toCsv(page, UPDATE_COLUMNS),
      rowCount: page.length,
      truncated,
      now,
    });
  });

  return router;
}
