import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { agentNextJobResponseSchema } from '@updatepilot/shared';

loadEnv({ path: '../../.env', quiet: true });
const hasDatabase = Boolean(process.env.DATABASE_URL && process.env.SESSION_SECRET);
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

describe.skipIf(!hasDatabase)('agent job channel (database)', () => {
  let prisma: (typeof import('../lib/prisma'))['prisma'];
  let app: express.Express;
  let hashAgentToken: (token: string) => string;
  const userIds: string[] = [];
  const deviceIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = await import('../lib/prisma'));
    ({ hashAgentToken } = await import('../devices/pairing'));
    const { agentRouter } = await import('./agent');
    const { errorHandler } = await import('../middleware/error-handler');
    const { notFound } = await import('../middleware/not-found');

    const quietLog = { error: () => undefined, info: () => undefined, warn: () => undefined };
    app = express();
    app.use((req, _res, next) => {
      Object.assign(req, { id: randomUUID(), log: quietLog });
      next();
    });
    app.use(express.json());
    app.use('/api/v1/agent', agentRouter());
    app.use(notFound);
    app.use(errorHandler);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.auditEvent.deleteMany({ where: { deviceId: { in: deviceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  /** A user with one ACTIVE device and a known agent token. Returns the raw token. */
  async function pairedDevice(status: 'ACTIVE' | 'PENDING' | 'REVOKED' = 'ACTIVE') {
    const token = `agent-${randomUUID()}`;
    const user = await prisma.user.create({
      data: { email: `agent-${randomUUID()}@example.test`, passwordHash: 'x' },
    });
    userIds.push(user.id);
    const device = await prisma.device.create({
      data: {
        ownerId: user.id,
        name: 'AGENT-TEST',
        status,
        credentials: { create: { tokenHash: hashAgentToken(token) } },
      },
    });
    deviceIds.push(device.id);
    return { token, deviceId: device.id, userId: user.id };
  }

  const poll = (token: string) =>
    request(app).get('/api/v1/agent/jobs/next').set('Authorization', `Bearer ${token}`);

  it('refuses a missing or unknown token with 401', async () => {
    expect((await request(app).get('/api/v1/agent/jobs/next')).status).toBe(401);

    const unknown = await poll('nobody-issued-this-token-and-it-is-long-enough');
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('refuses a revoked device with 403, so the agent stops polling', async () => {
    const { token } = await pairedDevice('REVOKED');
    const res = await poll(token);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('answers with no job and the poll interval, and records the heartbeat', async () => {
    const { token, deviceId } = await pairedDevice('PENDING');

    const res = await poll(token);
    expect(res.status).toBe(200);
    const body = agentNextJobResponseSchema.parse(res.body);
    expect(body.job).toBeNull();
    expect(body.pollIntervalSeconds).toBe(10);

    const device = await prisma.device.findUniqueOrThrow({ where: { id: deviceId } });
    expect(device.lastSeenAt).not.toBeNull();
    expect(device.status).toBe('ACTIVE');

    const credential = await prisma.agentCredential.findFirstOrThrow({ where: { deviceId } });
    expect(credential.lastUsedAt).not.toBeNull();
  });

  it('claims a queued scan exactly once', async () => {
    const { token, deviceId, userId } = await pairedDevice();
    const job = await prisma.scanJob.create({
      data: { deviceId, requestedById: userId, state: 'QUEUED' },
    });

    const first = await poll(token);
    expect(first.body.job).toEqual({ kind: 'scan', jobId: job.id });

    const claimed = await prisma.scanJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(claimed.state).toBe('RUNNING');
    expect(claimed.startedAt).not.toBeNull();

    const second = await poll(token);
    expect(second.body.job).toBeNull();
  });

  it('does not hand one device the job of another', async () => {
    const mine = await pairedDevice();
    const other = await pairedDevice();
    const job = await prisma.scanJob.create({
      data: { deviceId: other.deviceId, state: 'QUEUED' },
    });

    expect((await poll(mine.token)).body.job).toBeNull();
    expect((await poll(other.token)).body.job).toEqual({ kind: 'scan', jobId: job.id });
  });

  it('interrupts a job whose lease ran out instead of leaving it running', async () => {
    const { token, deviceId } = await pairedDevice();
    const job = await prisma.scanJob.create({
      data: {
        deviceId,
        state: 'RUNNING',
        startedAt: new Date(Date.now() - 11 * 60 * 1000), // lease is 10 minutes
      },
    });

    await poll(token);

    const row = await prisma.scanJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.state).toBe('INTERRUPTED');
    expect(row.finishedAt).not.toBeNull();
    expect(row.errorSummary).toContain('stopped responding');
  });

  it('cancels a queued scan that expired before the agent claimed it', async () => {
    const { token, deviceId } = await pairedDevice();
    const job = await prisma.scanJob.create({
      data: {
        deviceId,
        state: 'QUEUED',
        createdAt: new Date(Date.now() - 16 * 60 * 1000),
      },
    });

    await poll(token);

    const row = await prisma.scanJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.state).toBe('CANCELLED');
    expect(row.finishedAt).not.toBeNull();
    expect(row.errorSummary).toContain('expired');
  });
});
