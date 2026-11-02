import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';

/** The OpenAPI file lives at <repo root>/docs/openapi.yaml. */
export const DEFAULT_OPENAPI_PATH = fileURLToPath(
  new URL('../../../docs/openapi.yaml', import.meta.url),
);

/**
 * Serves Swagger UI at /api/docs and the raw spec at /api/openapi.json.
 * Swagger UI needs inline scripts, so the strict content security policy is
 * relaxed for these routes only. Docs are off by default in production.
 */
export function createDocsRouter(openapiPath: string = DEFAULT_OPENAPI_PATH): Router {
  if (!existsSync(openapiPath)) {
    throw new Error(`OpenAPI file not found at ${openapiPath}`);
  }
  const spec = YAML.parse(readFileSync(openapiPath, 'utf8')) as Record<string, unknown>;

  const router = Router();
  router.use(helmet({ contentSecurityPolicy: false }));
  router.get('/openapi.json', (_req, res) => {
    res.json(spec);
  });
  router.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(spec, { customSiteTitle: 'UpdatePilot API' }),
  );
  return router;
}
