import { Router } from 'express';
import type { HealthResponse, ReadinessResponse } from '@updatepilot/shared';

type Deps = {
  version: string;
  checkDatabase: () => Promise<void>;
};

export function healthRouter({ version, checkDatabase }: Deps): Router {
  const router = Router();

  // Liveness: the process is up. Never touches the database.
  router.get('/health', (_req, res) => {
    const body: HealthResponse = { status: 'ok', time: new Date().toISOString(), version };
    res.json(body);
  });

  // Readiness: the process can serve real requests (database reachable).
  router.get('/health/ready', async (req, res) => {
    try {
      await checkDatabase();
      const body: ReadinessResponse = { status: 'ready', checks: { database: 'up' } };
      res.json(body);
    } catch (error) {
      // Log the cause on the server; never return database error text to the client.
      req.log.warn({ err: error }, 'Readiness check failed');
      const body: ReadinessResponse = { status: 'unavailable', checks: { database: 'down' } };
      res.status(503).json(body);
    }
  });

  return router;
}
