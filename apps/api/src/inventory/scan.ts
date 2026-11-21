import type { Job, ScannedApplication } from '@updatepilot/shared';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { appKeyFor, deriveStatuses } from './matching';

/** The API accepts at most this many applications per scan (shared schema enforces the same). */
export const MAX_SCAN_APPLICATIONS = 5000;

type ScanJobRow = {
  id: string;
  deviceId: string;
  state: Job['state'];
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  appCount: number | null;
  errorSummary: string | null;
};

/**
 * A scan job in the shared `Job` shape, so one contract covers scans and updates:
 * the scan-specific fields are simply empty.
 */
export function toScanJob(row: ScanJobRow): Job {
  return {
    id: row.id,
    kind: 'scan',
    state: row.state,
    deviceId: row.deviceId,
    applicationId: null,
    packageId: null,
    fromVersion: null,
    targetVersion: null,
    requestedAt: row.createdAt.toISOString(),
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    exitCode: null,
    restartRequired: false,
    verification: 'NOT_RUN',
    errorSummary: row.errorSummary,
  };
}

/**
 * Stores one scan.
 *
 * Everything happens in one transaction, because a half-applied scan is worse than no scan:
 * the job only becomes SUCCEEDED if every row was written.
 *
 *  1. Compare-and-set the job RUNNING -> SUCCEEDED. A second submission updates nothing and gets
 *     a 409, so a retried request can never duplicate history.
 *  2. Upsert each application by appKey, which is what makes rescans idempotent.
 *  3. Write an immutable snapshot per application, so history is never overwritten.
 *  4. Mark anything this scan did not report as removed.
 */
export async function storeScanResults(args: {
  deviceId: string;
  jobId: string;
  applications: ScannedApplication[];
  startedAt: Date;
  finishedAt: Date;
  now: Date;
}): Promise<Job> {
  const { deviceId, jobId, applications, finishedAt, now } = args;

  // Clamp: an agent with a clock ahead of ours must not make "last seen before the scan started"
  // match the rows it just sent, which would mark the whole machine as uninstalled.
  const startedAt = new Date(Math.min(args.startedAt.getTime(), now.getTime()));

  // One row per identity. A real scan can report the same identity twice: WinGet often lists two
  // builds of an application it cannot identify (no package ID), so both collapse to the same
  // name|publisher|architecture key. Storing both would violate the snapshot unique constraint.
  const unique: ScannedApplication[] = [];
  const seenKeys = new Set<string>();
  for (const application of applications) {
    const key = appKeyFor(application);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    unique.push(application);
  }

  const job = await prisma.$transaction(
    async (tx) => {
      const claimed = await tx.scanJob.updateMany({
        where: { id: jobId, deviceId, state: 'RUNNING' },
        data: { state: 'SUCCEEDED', startedAt, finishedAt, appCount: unique.length },
      });
      if (claimed.count === 0) {
        throw new AppError(
          'INVALID_STATE',
          'This scan job is not running, so its results cannot be stored.',
        );
      }

      const stored: {
        applicationId: string;
        appKey: string;
        application: ScannedApplication;
        matchStatus: 'MATCHED' | 'UNMATCHED' | 'UNSUPPORTED' | 'UNKNOWN';
      }[] = [];

      for (const application of unique) {
        const appKey = appKeyFor(application);
        const { matchStatus, updateStatus } = deriveStatuses(application);

        const row = await tx.application.upsert({
          where: { deviceId_appKey: { deviceId, appKey } },
          create: {
            deviceId,
            appKey,
            displayName: application.displayName,
            publisher: application.publisher,
            installedVersion: application.installedVersion,
            availableVersion: application.availableVersion,
            packageId: application.packageId,
            source: application.source,
            architecture: application.architecture,
            matchStatus,
            updateStatus,
            firstSeenAt: now,
            lastSeenAt: now,
          },
          update: {
            displayName: application.displayName,
            publisher: application.publisher,
            installedVersion: application.installedVersion,
            availableVersion: application.availableVersion,
            packageId: application.packageId,
            source: application.source,
            architecture: application.architecture,
            matchStatus,
            updateStatus,
            lastSeenAt: now,
            // Reinstalled after being removed: gone no longer.
            removedAt: null,
          },
          select: { id: true },
        });

        stored.push({ applicationId: row.id, appKey, application, matchStatus });
      }

      if (stored.length > 0) {
        await tx.applicationSnapshot.createMany({
          // Defence in depth: the keys are already unique above.
          skipDuplicates: true,
          data: stored.map((entry) => ({
            scanJobId: jobId,
            applicationId: entry.applicationId,
            appKey: entry.appKey,
            displayName: entry.application.displayName,
            publisher: entry.application.publisher,
            installedVersion: entry.application.installedVersion,
            packageId: entry.application.packageId,
            source: entry.application.source,
            matchStatus: entry.matchStatus,
            capturedAt: now,
          })),
        });
      }

      // Anything the scan did not report is gone from this machine.
      await tx.application.updateMany({
        where: { deviceId, removedAt: null, lastSeenAt: { lt: startedAt } },
        data: { removedAt: now },
      });

      return tx.scanJob.findUniqueOrThrow({ where: { id: jobId } });
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  return toScanJob(job);
}
