import { Router } from 'express';
import { scanResultsRequestSchema, type Job } from '@updatepilot/shared';
import type { z } from 'zod';
import { authenticateAgent } from '../agent/auth';
import { claimNextJob, interruptExpiredJobs } from '../agent/claim';
import { writeAudit } from '../auth';
import { AGENT_POLL_INTERVAL_SECONDS } from '../inventory/connection';
import { storeScanResults } from '../inventory/scan';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
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

  return router;
}
