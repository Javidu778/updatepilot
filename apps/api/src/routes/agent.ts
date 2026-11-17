import { Router } from 'express';
import { authenticateAgent } from '../agent/auth';
import { claimNextJob, interruptExpiredJobs } from '../agent/claim';
import { AGENT_POLL_INTERVAL_SECONDS } from '../inventory/connection';
import { noStore } from '../middleware/no-store';

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

  return router;
}
