import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { createAuthRouter } from './auth';
import type { AppConfig } from './config';
import { createDocsRouter } from './docs';
import { errorHandler } from './middleware/error-handler';
import type { Logger } from './lib/logger';
import { notFound } from './middleware/not-found';
import { createRateLimiter } from './middleware/rate-limit';
import { healthRouter } from './routes/health';

export type AppDeps = {
  config: AppConfig;
  logger: Logger;
  /** Resolves when the database answers, rejects otherwise. Injected so tests need no database. */
  checkDatabase: () => Promise<void>;
  /** Path to the OpenAPI file. Defaults to docs/openapi.yaml at the repo root. */
  openapiPath?: string;
  /** Mount extra routes before the 404 handler. Used by tests; real routes get their own routers. */
  extraRoutes?: (app: Express) => void;
};

export function createApp({
  config,
  logger,
  checkDatabase,
  openapiPath,
  extraRoutes,
}: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  // Request id and structured request logging. The id is generated here, never trusted from the client.
  app.use(
    pinoHttp({
      logger,
      genReqId: (_req, res) => {
        const id = randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
    }),
  );
  

  // API docs (Swagger UI). Mounted before the global security headers because they relax CSP for these routes only.
  if (config.enableApiDocs) {
    try {
      app.use('/api', createDocsRouter(openapiPath));
    } catch (error) {
      logger.warn({ err: error }, 'API docs disabled');
    }
  }

  app.use(helmet());

  // CORS: exactly one allowed browser origin. Requests without an Origin header (agent, curl) pass through.
  app.use(
    cors({
      origin: (origin, callback) => callback(null, !origin || origin === config.webOrigin),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key'],
      maxAge: 600,
    }),
  );

  app.use(createRateLimiter(config.rateLimit));

  // Default body limit. Agent scan uploads (up to 5000 apps) get a higher limit on their own route in Week 3.
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/v1', healthRouter({ version: config.version, checkDatabase }));
  app.use('/api/v1/auth', createAuthRouter());

  extraRoutes?.(app);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
