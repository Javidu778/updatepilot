import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { jobSchema } from '@updatepilot/shared';

loadEnv({ path: '../../.env', quiet: true });
const hasDatabase = Boolean(process.env.DATABASE_URL && process.env.SESSION_SECRET);
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const PASSWORD = 'Correct-Horse-Battery-9';

describe.skipIf(!hasDatabase)('scan routes (database)', () => {
  let prisma: (typeof import('../lib/prisma'))['prisma'];
  let hashAgentToken: (token: string) => string;
  let app: express.Express;
  const userIds: string[] = [];
  const deviceIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = await import('../lib/prisma'));
    ({ hashAgentToken } = await import('../devices/pairing'));
    const { createAuthRouter } = await import('../auth');
    const { devicesRouter } = await import('./devices');
    const { agentRouter } = await import('./agent');
    const { scansRouter } = await import('./scans');
    const { errorHandler } = await import('../middleware/error-handler');
    const { notFound } = await import('../middleware/not-found');

    const quietLog = { error: () => undefined, info: () => undefined, warn: () => undefined };
    app = express();
    app.use((req, _res, next) => {
      Object.assign(req, { id: randomUUID(), log: quietLog });
      next();
    });
    app.use(express.json({ limit: '2mb' }));
    app.use('/api/v1/auth', createAuthRouter({ registerLimit: 10_000 }));
    app.use('/api/v1/devices', devicesRouter());
    app.use('/api/v1/agent', agentRouter());
    app.use('/api/v1', scansRouter());
    app.use(notFound);
    app.use(errorHandler);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.auditEvent.deleteMany({
      where: { OR: [{ actorUserId: { in: userIds } }, { deviceId: { in: deviceIds } }] },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  async function signedIn() {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: `scan-${randomUUID()}@example.test`, password: PASSWORD });
    const setCookie = res.headers['set-cookie'];
    if (!setCookie) throw new Error('Registration response did not include a session cookie.');
    userIds.push(res.body.user.id);
    return {
      cookie: Array.isArray(setCookie) ? setCookie : [setCookie],
      csrfToken: res.body.csrfToken as string,
    };
  }

  async function deviceFor(session: { cookie: string[]; csrfToken: string }) {
    const code = await request(app)
      .post('/api/v1/devices/pairing-codes')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrfToken);
    const token = `agent-${randomUUID()}`;
    const paired = await request(app)
      .post('/api/v1/devices/pair')
      .send({ pairingCode: code.body.code, deviceName: 'SCAN-PC' });
    deviceIds.push(paired.body.deviceId);

    // The agent token from pairing is what the results route needs; swap in a known one.
    await prisma.agentCredential.updateMany({
      where: { deviceId: paired.body.deviceId },
      data: { tokenHash: hashAgentToken(token) },
    });
    return { deviceId: paired.body.deviceId as string, agentToken: token };
  }

  const startScan = (
    session: { cookie: string[]; csrfToken: string },
    deviceId: string,
    key?: string,
  ) =>
    request(app)
      .post(`/api/v1/devices/${deviceId}/scans`)
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrfToken)
      .set(key ? { 'Idempotency-Key': key } : {});

  const application = (overrides: Record<string, unknown> = {}) => ({
    displayName: 'Git',
    publisher: null,
    installedVersion: '2.44.0',
    availableVersion: '2.45.1',
    packageId: 'Git.Git',
    source: 'winget',
    architecture: null,
    ...overrides,
  });

  it('queues a scan and returns the shared Job shape', async () => {
    const session = await signedIn();
    const { deviceId } = await deviceFor(session);

    const res = await startScan(session, deviceId);
    expect(res.status).toBe(202);
    const job = jobSchema.parse(res.body);
    expect(job.kind).toBe('scan');
    expect(job.state).toBe('QUEUED');
    expect(job.deviceId).toBe(deviceId);
  });

  it('refuses a second scan while one is queued', async () => {
    const session = await signedIn();
    const { deviceId } = await deviceFor(session);

    await startScan(session, deviceId);
    const second = await startScan(session, deviceId);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('INVALID_STATE');
  });

  it('returns the same job for a repeated Idempotency-Key', async () => {
    const session = await signedIn();
    const { deviceId } = await deviceFor(session);
    const key = randomUUID();

    const first = await startScan(session, deviceId, key);
    const second = await startScan(session, deviceId, key);
    expect(second.status).toBe(202);
    expect(second.body.id).toBe(first.body.id);
  });

  it("does not let a user scan another user's device", async () => {
    const owner = await signedIn();
    const intruder = await signedIn();
    const { deviceId } = await deviceFor(owner);

    const res = await startScan(intruder, deviceId);
    expect(res.status).toBe(404);
  });

  it('stores results: applications, snapshots, job SUCCEEDED', async () => {
    const session = await signedIn();
    const { deviceId, agentToken } = await deviceFor(session);
    await startScan(session, deviceId);

    // The agent claims the job first, exactly as it does in real life.
    const poll = await request(app)
      .get('/api/v1/agent/jobs/next')
      .set('Authorization', `Bearer ${agentToken}`);
    const jobId = poll.body.job.jobId as string;

    const res = await request(app)
      .post(`/api/v1/agent/scans/${jobId}/results`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({
        startedAt: new Date(Date.now() - 5000).toISOString(),
        finishedAt: new Date().toISOString(),
        applications: [
          application(),
          application({
            displayName: 'Contoso Tool',
            packageId: null,
            source: null,
            availableVersion: null,
            installedVersion: '2.1',
          }),
        ],
      });

    expect(res.status).toBe(200);
    const job = jobSchema.parse(res.body);
    expect(job.state).toBe('SUCCEEDED');

    const stored = await prisma.application.findMany({
      where: { deviceId },
      orderBy: { displayName: 'asc' },
    });
    expect(stored).toHaveLength(2);
    expect(stored[0].matchStatus).toBe('UNMATCHED');
    expect(stored[1].updateStatus).toBe('UPDATE_AVAILABLE');

    const snapshots = await prisma.applicationSnapshot.count({ where: { scanJobId: jobId } });
    expect(snapshots).toBe(2);
  });

  it('stores one row when a scan reports the same identity twice', async () => {
    const session = await signedIn();
    const { deviceId, agentToken } = await deviceFor(session);
    await startScan(session, deviceId);

    const poll = await request(app)
      .get('/api/v1/agent/jobs/next')
      .set('Authorization', `Bearer ${agentToken}`);
    const jobId = poll.body.job.jobId as string;

    // Two builds of an application WinGet cannot identify: same name, different version, so both
    // collapse to one appKey. This used to violate the snapshot unique constraint and answer 500.
    const res = await request(app)
      .post(`/api/v1/agent/scans/${jobId}/results`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({
        startedAt: new Date(Date.now() - 5000).toISOString(),
        finishedAt: new Date().toISOString(),
        applications: [
          application({
            displayName: 'Contoso Runtime',
            packageId: null,
            source: null,
            availableVersion: null,
            installedVersion: '1.0',
          }),
          application({
            displayName: 'Contoso Runtime',
            packageId: null,
            source: null,
            availableVersion: null,
            installedVersion: '2.0',
          }),
        ],
      });

    expect(res.status).toBe(200);
    expect(jobSchema.parse(res.body).state).toBe('SUCCEEDED');

    expect(await prisma.application.count({ where: { deviceId } })).toBe(1);
    expect(await prisma.applicationSnapshot.count({ where: { scanJobId: jobId } })).toBe(1);
  });

  it('marks an application removed when a later scan no longer reports it', async () => {
    const session = await signedIn();
    const { deviceId, agentToken } = await deviceFor(session);

    const scanAndReport = async (
      applications: unknown[],
      startedAt = new Date(Date.now() - 5000),
    ) => {
      await startScan(session, deviceId);
      const poll = await request(app)
        .get('/api/v1/agent/jobs/next')
        .set('Authorization', `Bearer ${agentToken}`);
      return request(app)
        .post(`/api/v1/agent/scans/${poll.body.job.jobId}/results`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          applications,
        });
    };

    await scanAndReport([
      application(),
      application({ displayName: '7-Zip', packageId: '7zip.7zip' }),
    ]);
    await scanAndReport([application()], new Date());

    const removed = await prisma.application.findFirstOrThrow({
      where: { deviceId, packageId: '7zip.7zip' },
    });
    expect(removed.removedAt).not.toBeNull();
  });

  it('rejects a second submission for the same scan with 409', async () => {
    const session = await signedIn();
    const { deviceId, agentToken } = await deviceFor(session);
    await startScan(session, deviceId);

    const poll = await request(app)
      .get('/api/v1/agent/jobs/next')
      .set('Authorization', `Bearer ${agentToken}`);
    const jobId = poll.body.job.jobId as string;
    const payload = {
      startedAt: new Date(Date.now() - 5000).toISOString(),
      finishedAt: new Date().toISOString(),
      applications: [application()],
    };

    const first = await request(app)
      .post(`/api/v1/agent/scans/${jobId}/results`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send(payload);
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/v1/agent/scans/${jobId}/results`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send(payload);
    expect(second.status).toBe(409);
  });
});
