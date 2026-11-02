import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { healthResponseSchema, readinessResponseSchema } from '@updatepilot/shared';
import { createApp } from './app';
import { loadConfig, type AppConfig } from './config';
import { AppError } from './lib/errors';
import { createLogger } from './lib/logger';
import { getValidated, validate } from './middleware/validate';

const baseConfig: AppConfig = {
  nodeEnv: 'test',
  port: 0,
  webOrigin: 'http://localhost:3000',
  logLevel: 'silent',
  enableApiDocs: true,
  version: '9.9.9',
  rateLimit: { windowMs: 60_000, limit: 1000 },
};

function makeApp(
  overrides: Partial<Parameters<typeof createApp>[0]> = {},
  config: Partial<AppConfig> = {},
) {
  return createApp({
    config: { ...baseConfig, ...config },
    logger: createLogger('silent'),
    checkDatabase: async () => {},
    ...overrides,
  });
}

describe('health', () => {
  it('reports liveness with the shared response shape', async () => {
    const res = await request(makeApp()).get('/api/v1/health');
    expect(res.status).toBe(200);
    const body = healthResponseSchema.parse(res.body);
    expect(body.version).toBe('9.9.9');
  });

  it('reports readiness when the database answers', async () => {
    const res = await request(makeApp()).get('/api/v1/health/ready');
    expect(res.status).toBe(200);
    expect(readinessResponseSchema.parse(res.body)).toEqual({
      status: 'ready',
      checks: { database: 'up' },
    });
  });

  it('returns 503 without leaking database errors when the database is down', async () => {
    const app = makeApp({
      checkDatabase: async () => {
        throw new Error('connect ECONNREFUSED postgres://user:secret@db:5432');
      },
    });
    const res = await request(app).get('/api/v1/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable', checks: { database: 'down' } });
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});

describe('request handling', () => {
  it('adds a unique request id to every response', async () => {
    const app = makeApp();
    const a = await request(app).get('/api/v1/health');
    const b = await request(app).get('/api/v1/health');
    expect(a.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
  });

  it('ignores a request id supplied by the client', async () => {
    const res = await request(makeApp())
      .get('/api/v1/health')
      .set('X-Request-Id', 'attacker-chosen');
    expect(res.headers['x-request-id']).not.toBe('attacker-chosen');
  });

  it('sends security headers and hides the framework', async () => {
    const res = await request(makeApp()).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
  });
});

describe('error format', () => {
  it('returns the common format for unknown routes', async () => {
    const res = await request(makeApp()).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await request(makeApp())
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"broken"');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 413 for oversized bodies', async () => {
    const big = JSON.stringify({ data: 'x'.repeat(1_100_000) });
    const res = await request(makeApp())
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send(big);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('maps AppError codes to their HTTP status', async () => {
    const app = makeApp({
      extraRoutes: (a) => {
        a.get('/test/forbidden', () => {
          throw new AppError('FORBIDDEN', 'Not allowed');
        });
        a.get('/test/state', () => {
          throw new AppError('INVALID_STATE', 'Job already finished');
        });
      },
    });
    expect((await request(app).get('/test/forbidden')).status).toBe(403);
    const state = await request(app).get('/test/state');
    expect(state.status).toBe(409);
    expect(state.body.error).toMatchObject({
      code: 'INVALID_STATE',
      message: 'Job already finished',
    });
  });

  it('hides internal details of unexpected errors, including async ones', async () => {
    const app = makeApp({
      extraRoutes: (a) => {
        a.get('/test/boom', async () => {
          throw new Error('SELECT * FROM "User" failed at C:\\secret\\path');
        });
      },
    });
    const res = await request(app).get('/test/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/SELECT|secret|stack/i);
  });
});

describe('validate middleware', () => {
  const querySchema = z.object({ page: z.coerce.number().int().min(1).default(1) });
  const bodySchema = z.strictObject({ name: z.string().min(1) });

  const app = makeApp({
    extraRoutes: (a) => {
      a.get('/test/list', validate({ query: querySchema }), (_req, res) => {
        res.json(getValidated<{ query: z.infer<typeof querySchema> }>(res).query);
      });
      a.post('/test/create', validate({ body: bodySchema }), (_req, res) => {
        res.status(201).json(getValidated<{ body: z.infer<typeof bodySchema> }>(res).body);
      });
    },
  });

  it('passes parsed and defaulted values to the handler', async () => {
    expect((await request(app).get('/test/list')).body).toEqual({ page: 1 });
    expect((await request(app).get('/test/list?page=3')).body).toEqual({ page: 3 });
  });

  it('rejects invalid query values with field-level details', async () => {
    const res = await request(app).get('/test/list?page=0');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toBe('page');
  });

  it('rejects unknown body fields on strict schemas', async () => {
    const res = await request(app).post('/test/create').send({ name: 'ok', admin: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts a valid body', async () => {
    const res = await request(app).post('/test/create').send({ name: 'ok' });
    expect(res.status).toBe(201);
  });
});

describe('CORS', () => {
  it('allows the configured web origin with credentials', async () => {
    const res = await request(makeApp())
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:3000');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not allow any other origin', async () => {
    const res = await request(makeApp())
      .get('/api/v1/health')
      .set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('never uses a wildcard', async () => {
    const res = await request(makeApp()).get('/api/v1/health');
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });
});

describe('rate limiting', () => {
  it('returns 429 in the common format once the limit is exceeded', async () => {
    const app = makeApp({}, { rateLimit: { windowMs: 60_000, limit: 2 } });
    await request(app).get('/api/v1/health');
    await request(app).get('/api/v1/health');
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.headers['retry-after']).toBeDefined();
  });
});

describe('API docs', () => {
  it('serves the OpenAPI spec and Swagger UI when enabled', async () => {
    const app = makeApp();
    const spec = await request(app).get('/api/openapi.json');
    expect(spec.status).toBe(200);
    expect(spec.body.openapi).toBe('3.0.3');
    const ui = await request(app).get('/api/docs/');
    expect(ui.status).toBe(200);
    expect(ui.text).toContain('swagger-ui');
  });

  it('is not served when disabled', async () => {
    const res = await request(makeApp({}, { enableApiDocs: false })).get('/api/openapi.json');
    expect(res.status).toBe(404);
  });

  it('keeps the app running when the spec file is missing', async () => {
    const res = await request(makeApp({ openapiPath: '/does/not/exist.yaml' })).get(
      '/api/v1/health',
    );
    expect(res.status).toBe(200);
  });
});

describe('loadConfig', () => {
  const valid = {
    WEB_ORIGIN: 'http://localhost:3000/',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_SECRET: 'replace-me',
  } as NodeJS.ProcessEnv;

  it('applies defaults and normalizes the web origin', () => {
    const config = loadConfig(valid);
    expect(config.port).toBe(4000);
    expect(config.webOrigin).toBe('http://localhost:3000');
    expect(config.enableApiDocs).toBe(true);
  });

  it('lists every problem when required variables are missing', () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(
      /WEB_ORIGIN[\s\S]*DATABASE_URL[\s\S]*JWT_SECRET/,
    );
  });

  it('rejects a weak secret in production', () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: 'production' })).toThrow(/JWT_SECRET/);
  });

  it('turns docs off by default in production', () => {
    const secret = 'x'.repeat(40);
    expect(loadConfig({ ...valid, NODE_ENV: 'production', JWT_SECRET: secret }).enableApiDocs).toBe(
      false,
    );
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ ...valid, API_PORT: '99999' })).toThrow(/API_PORT/);
  });
});
