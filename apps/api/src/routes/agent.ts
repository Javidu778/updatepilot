import { Router } from 'express';
import {
  agentProgressRequestSchema,
  scanResultsRequestSchema,
  updateResultRequestSchema,
  type AuditEventType,
  type Job,
} from '@updatepilot/shared';
import type { z } from 'zod';
import { authenticateAgent } from '../agent/auth';
import { claimNextJob, interruptExpiredJobs } from '../agent/claim';
import { writeAudit } from '../auth';
import { AGENT_POLL_INTERVAL_SECONDS } from '../inventory/connection';
import { toUpdateJob } from '../inventory/serialize';
import { storeScanResults } from '../inventory/scan';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { decideUpdateOutcome } from '../updates/finalize';
import { noStore } from '../middleware/no-store';
import { getValidated, validate } from '../middleware/validate';

type ScanResultsRequest = z.infer<typeof scanResultsRequestSchema>;

/**
 * The agent channel. Mount at /api/v1/agent.
 *
 * Every route is authenticated with the agent's own credential, never a user session, and
 * every response is private: no-store.
 */
export function agentRouter(): Router {
  const router = Router();
  router.use(noStore);

  // GET /api/v1/agent/jobs/next: heartbeat plus one job, or an empty answer.
  router.get('/jobs/next', authenticateAgent, async (req, res) => {
    const now = new Date();
    const { device } = req.agent!;

    const interrupted = await interruptExpiredJobs(device.id, now);
    if (interrupted > 0) {
      req.log.warn({ deviceId: device.id, interrupted }, 'interrupted jobs whose lease expired');
    }

    const job = await claimNextJob(device.id, now);
    res.json({
      job,
      pollIntervalSeconds: AGENT_POLL_INTERVAL_SECONDS,
      serverTime: now.toISOString(),
    });
  });

  // POST /api/v1/agent/scans/:id/results: the agent reports what one scan found.
  router.post(
    '/scans/:id/results',
    authenticateAgent,
    validate({ body: scanResultsRequestSchema }),
    async (req, res) => {
      const { device } = req.agent!;
      const jobId = String(req.params.id);
      const { startedAt, finishedAt, applications } = getValidated<{
        body: ScanResultsRequest;
      }>(res).body;

      const started = new Date(startedAt);
      const finished = new Date(finishedAt);
      if (finished.getTime() < started.getTime()) {
        throw new AppError('VALIDATION_ERROR', 'finishedAt must not be before startedAt.');
      }

      // A job that belongs to another device is indistinguishable from one that does not exist.
      const job = await prisma.scanJob.findFirst({
        where: { id: jobId, deviceId: device.id },
        select: { id: true, state: true },
      });
      if (!job) throw new AppError('NOT_FOUND', 'That scan does not belong to this device.');
      if (job.state !== 'RUNNING') {
        throw new AppError('INVALID_STATE', 'That scan is not running.');
      }

      const stored: Job = await storeScanResults({
        deviceId: device.id,
        jobId,
        applications,
        startedAt: started,
        finishedAt: finished,
        now: new Date(),
      });

      await writeAudit(
        {
          actorType: 'AGENT',
          deviceId: device.id,
          eventType: 'SCAN_COMPLETED',
          targetType: 'scan_job',
          targetId: jobId,
          metadata: { appCount: applications.length },
        },
        req.log,
      );

      res.json(stored);
    },
  );

  // POST /api/v1/agent/jobs/:id/progress: the agent says the update started, or is verifying.
  router.post(
    '/jobs/:id/progress',
    authenticateAgent,
    validate({ body: agentProgressRequestSchema }),
    async (req, res) => {
      const { device } = req.agent!;
      const jobId = String(req.params.id);
      const { state } = getValidated<{ body: { state: 'RUNNING' | 'VERIFYING' } }>(res).body;

      const job = await prisma.updateJob.findFirst({
        where: { id: jobId, deviceId: device.id },
        select: { id: true, state: true },
      });
      if (!job) throw new AppError('NOT_FOUND', 'That update does not belong to this device.');

      // Progress only moves forward: once verifying, it cannot go back to running.
      if (job.state === 'VERIFYING' && state === 'RUNNING') {
        throw new AppError('INVALID_STATE', 'That update is already being verified.');
      }
      if (job.state !== 'RUNNING' && job.state !== 'VERIFYING') {
        throw new AppError('INVALID_STATE', 'That update is not running.');
      }

      const updated = await prisma.updateJob.update({
        where: { id: jobId },
        data: { state },
      });

      if (state === 'RUNNING') {
        await writeAudit(
          {
            actorType: 'AGENT',
            deviceId: device.id,
            eventType: 'UPDATE_STARTED',
            targetType: 'update_job',
            targetId: jobId,
            metadata: { packageId: updated.packageId },
          },
          req.log,
        );
      }

      res.json(toUpdateJob(updated));
    },
  );

  // POST /api/v1/agent/updates/:id/result: exit code, restart flag and the version found on rescan.
  router.post(
    '/updates/:id/result',
    authenticateAgent,
    validate({ body: updateResultRequestSchema }),
    async (req, res) => {
      const { device } = req.agent!;
      const jobId = String(req.params.id);
      const { exitCode, restartRequired, installedVersionAfter, errorSummary } = getValidated<{
        body: {
          exitCode: number;
          restartRequired: boolean;
          installedVersionAfter: string | null;
          errorSummary: string | null;
        };
      }>(res).body;

      const job = await prisma.updateJob.findFirst({
        where: { id: jobId, deviceId: device.id },
        select: { id: true, state: true, targetVersion: true, applicationId: true },
      });
      if (!job) throw new AppError('NOT_FOUND', 'That update does not belong to this device.');
      if (job.state !== 'RUNNING' && job.state !== 'VERIFYING') {
        throw new AppError('INVALID_STATE', 'That update is not running.');
      }

      // The server decides the outcome; the agent only reports facts.
      const outcome = decideUpdateOutcome({
        exitCode,
        restartRequired,
        installedVersionAfter,
        targetVersion: job.targetVersion,
      });

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.updateJob.update({
          where: { id: jobId },
          data: {
            state: outcome.state,
            finishedAt: new Date(),
            exitCode,
            restartRequired,
            verification: outcome.verification,
            verifiedVersion: installedVersionAfter,
            errorSummary: errorSummary ?? outcome.reason,
          },
        });

        // A verified update also updates the inventory row, so the list reflects reality before the
        // next scan runs. The next scan remains the source of truth.
        if (outcome.state === 'SUCCEEDED' && installedVersionAfter) {
          await tx.application.update({
            where: { id: job.applicationId },
            data: { installedVersion: installedVersionAfter, updateStatus: 'UP_TO_DATE' },
          });
        }

        return row;
      });

      const auditEvent: AuditEventType =
        outcome.state === 'SUCCEEDED'
          ? 'UPDATE_VERIFIED'
          : outcome.state === 'VERIFICATION_FAILED'
            ? 'UPDATE_VERIFICATION_FAILED'
            : 'UPDATE_FAILED';

      await writeAudit(
        {
          actorType: 'AGENT',
          deviceId: device.id,
          eventType: auditEvent,
          targetType: 'update_job',
          targetId: jobId,
          metadata: {
            packageId: updated.packageId,
            exitCode,
            state: outcome.state,
          },
        },
        req.log,
      );

      res.json(toUpdateJob(updated));
    },
  );

  return router;
}
