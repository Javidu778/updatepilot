import { Router } from 'express';
import {
  securityFindingsQuerySchema,
  securityFindingsResponseSchema,
  type SecurityFindingsQuery,
} from '@updatepilot/shared';
import { requireAuth } from '../auth';
import { prisma } from '../lib/prisma';
import { noStore } from '../middleware/no-store';
import { getValidated, validate } from '../middleware/validate';

const MAX_SKIP = 2_000_000_000;

/**
 * Mount at /api/v1/security.
 *
 * Findings are only ever shown for packages the user actually has installed, and the response
 * always carries where the data came from, when it was checked and what it does not cover.
 *
 * There is no live advisory feed yet: the OSV integration is later work, and until then every row
 * is seeded sample data. That is stated in `meta` rather than left for the reader to guess, because
 * an empty or sample list must never be read as "this machine is safe".
 */
export function securityRouter(): Router {
  const router = Router();
  router.use(noStore);

  router.get(
    '/findings',
    requireAuth,
    validate({ query: securityFindingsQuerySchema }),
    async (req, res) => {
      const { page, pageSize, packageId, severity, deviceId } = getValidated<{
        query: SecurityFindingsQuery;
      }>(res).query;

      // Scope: the packages this user has, so another account's inventory is never implied.
      const applications = await prisma.application.findMany({
        where: {
          device: { ownerId: req.auth!.user.id },
          packageId: { not: null },
          ...(deviceId ? { deviceId } : {}),
        },
        select: { packageId: true },
        distinct: ['packageId'],
      });
      const ownedPackageIds = applications
        .map((application) => application.packageId)
        .filter((value): value is string => value !== null);

      if (ownedPackageIds.length === 0) {
        res.json(
          securityFindingsResponseSchema.parse({
            data: [],
            page,
            pageSize,
            total: 0,
            totalPages: 0,
            meta: {
              checkedAt: null,
              source: 'None',
              limitations: 'No matched applications yet, so there is nothing to check.',
              isSample: false,
            },
          }),
        );
        return;
      }

      const where = {
        packageId: packageId ? packageId : { in: ownedPackageIds },
        ...(severity ? { severity } : {}),
      };

      const skip = (page - 1) * pageSize;
      const [total, rows] = await Promise.all([
        prisma.securityFinding.count({ where }),
        skip > MAX_SKIP
          ? Promise.resolve([])
          : prisma.securityFinding.findMany({
              where,
              orderBy: [{ severity: 'asc' }, { lastVerifiedAt: 'desc' }, { id: 'asc' }],
              skip,
              take: pageSize,
            }),
      ]);

      const allSample = rows.length > 0 && rows.every((row) => row.isSample);
      const sources = [...new Set(rows.map((row) => row.source))];
      const checkedAt = rows.reduce<Date | null>((latest, row) => {
        if (!latest || row.lastVerifiedAt > latest) return row.lastVerifiedAt;
        return latest;
      }, null);

      const body = securityFindingsResponseSchema.parse({
        data: rows.map((row) => ({
          id: row.id,
          packageId: row.packageId,
          advisoryId: row.advisoryId,
          severity: row.severity,
          summary: row.summary,
          affectedRange: row.affectedRange,
          fixedVersion: row.fixedVersion,
          source: row.source,
          sourceUrl: row.sourceUrl,
          lastVerifiedAt: row.lastVerifiedAt.toISOString(),
        })),
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        meta: {
          checkedAt: checkedAt ? checkedAt.toISOString() : null,
          source:
            rows.length === 0
              ? 'No advisory feed connected yet'
              : allSample
                ? 'Sample data'
                : sources.join(', '),
          limitations:
            'Only known advisories for packages that could be matched are listed. An empty list does not prove an application is safe.',
          isSample: allSample,
        },
      });

      res.json(body);
    },
  );

  return router;
}
