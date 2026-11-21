import type { AgentJob } from '@updatepilot/shared';
import { prisma } from '../lib/prisma';

/**
 * How long a claimed job may stay RUNNING before the server decides the agent died.
 * A scan is a few seconds of WinGet; an upgrade can legitimately install for half an hour.
 */
export const SCAN_LEASE_MS = 10 * 60 * 1000;
export const UPDATE_LEASE_MS = 30 * 60 * 1000;
export const QUEUE_EXPIRY_MS = 15 * 60 * 1000;

/**
 * Moves jobs that outlived their lease to INTERRUPTED.
 *
 * Without this, a crashed agent would leave a scan RUNNING for ever and the UI would show
 * "scanning" on a machine that is not doing anything. The user rescans before retrying
 * (docs/job-states.md).
 */
export async function interruptExpiredJobs(deviceId: string, now: Date): Promise<number> {
  const [queuedScans, queuedUpdates, runningScans, runningUpdates] = await Promise.all([
    prisma.scanJob.updateMany({
      where: {
        deviceId,
        state: 'QUEUED',
        createdAt: { lt: new Date(now.getTime() - QUEUE_EXPIRY_MS) },
      },
      data: {
        state: 'CANCELLED',
        finishedAt: now,
        errorSummary: 'The scan expired before the agent claimed it.',
      },
    }),
    prisma.updateJob.updateMany({
      where: {
        deviceId,
        state: 'QUEUED',
        createdAt: { lt: new Date(now.getTime() - QUEUE_EXPIRY_MS) },
      },
      data: {
        state: 'CANCELLED',
        finishedAt: now,
        errorSummary: 'The update expired before the agent claimed it.',
      },
    }),
    prisma.scanJob.updateMany({
      where: {
        deviceId,
        state: 'RUNNING',
        startedAt: { lt: new Date(now.getTime() - SCAN_LEASE_MS) },
      },
      data: {
        state: 'INTERRUPTED',
        finishedAt: now,
        errorSummary: 'The agent stopped responding during the scan.',
      },
    }),
    prisma.updateJob.updateMany({
      where: {
        deviceId,
        state: { in: ['RUNNING', 'VERIFYING'] },
        startedAt: { lt: new Date(now.getTime() - UPDATE_LEASE_MS) },
      },
      data: {
        state: 'INTERRUPTED',
        finishedAt: now,
        errorSummary: 'The agent stopped responding during the update.',
      },
    }),
  ]);
  return queuedScans.count + queuedUpdates.count + runningScans.count + runningUpdates.count;
}

/**
 * Claims the oldest queued job for this device, or returns null.
 *
 * The claim is a compare-and-set: `updateMany` with `state: 'QUEUED'` in the WHERE clause.
 * Two agents polling the same device can both read the row, but only one update affects a row,
 * so only one of them receives the job. No transaction and no row lock are needed for that.
 */
export async function claimNextJob(deviceId: string, now: Date): Promise<AgentJob | null> {
  // Scans first: they are quick, and a stale inventory makes an update decision worse.
  for (let attempt = 0; attempt < 3; attempt++) {
    const next = await prisma.scanJob.findFirst({
      where: { deviceId, state: 'QUEUED' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (!next) break;

    const claimed = await prisma.scanJob.updateMany({
      where: { id: next.id, state: 'QUEUED' },
      data: { state: 'RUNNING', startedAt: now },
    });

    if (claimed.count === 1) return { kind: 'scan', jobId: next.id };
    // Somebody else claimed it between the read and the update. Try the next row.
  }

  // Then updates, with the same compare-and-set.
  for (let attempt = 0; attempt < 3; attempt++) {
    const next = await prisma.updateJob.findFirst({
      where: { deviceId, state: 'QUEUED' },
      orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }],
      select: { id: true, packageId: true, targetVersion: true },
    });
    if (!next) return null;

    const claimed = await prisma.updateJob.updateMany({
      where: { id: next.id, state: 'QUEUED' },
      data: { state: 'RUNNING', startedAt: now },
    });

    if (claimed.count === 1) {
      // The payload the agent receives: only these four fields, and `winget` as the only source.
      return {
        kind: 'upgrade',
        jobId: next.id,
        packageId: next.packageId,
        targetVersion: next.targetVersion,
        source: 'winget',
      };
    }
  }
  return null;
}
