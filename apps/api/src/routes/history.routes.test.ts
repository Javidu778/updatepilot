import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { historyResponseSchema } from '@updatepilot/shared';

loadEnv({ path: '../../.env', quiet: true });
const hasDatabase = Boolean(process.env.DATABASE_URL && process.env.SESSION_SECRET);
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const PASSWORD = 'Correct-Horse-Battery-9';

describe.skipIf(!hasDatabase)('history routes (database)', () => {
  let prisma: (typeof import('../lib/prisma'))['prisma'];
  let app: express.Express;
  const userIds: string[] = [];
  const deviceIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = await import('../lib/prisma'));
    const { createAuthRouter } = await import('../auth');
    const { historyRouter } = await import('./history');
    const { errorHandler } = await import('../middleware/error-handler');
    const { notFound } = await import('../middleware/not-found');

    const quietLog = { error: () => undefined, info: () => undefined, warn: () => undefined };
    app = express();
    app.use((req, _res, next) => {
      Object.assign(req, { id: randomUUID(), log: quietLog });
      next();
    });
    app.use(express.json());
    app.use('/api/v1/auth', createAuthRouter({ registerLimit: 10_000 }));
    app.use('/api/v1/history', historyRouter());
    app.use(notFound);
    app.use(errorHandler);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.auditEvent.deleteMany({ where: { deviceId: { in: deviceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  async function signedIn() {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: `hist-${randomUUID()}@example.test`, password: PASSWORD });
    userIds.push(res.body.user.id);
    // The cookie array is what supertest's .set('Cookie', …) wants.
    const cookie = res.headers['set-cookie'] as unknown as string[];
    return { cookie, csrfToken: res.body.csrfToken as string, userId: res.body.user.id as string };
  }

  async function deviceWithHistory(userId: string) {
    const device = await prisma.device.create({
      data: { ownerId: userId, name: 'HIST-PC', status: 'ACTIVE' },
    });
    deviceIds.push(device.id);

    const application = await prisma.application.create({
      data: {
        deviceId: device.id,
        appKey: `pkg:hist.${randomUUID()}`,
        displayName: 'History App',
        installedVersion: '1.0.0',
        availableVersion: '1.1.0',
        packageId: 'Test.HistoryApp',
        source: 'winget',
        matchStatus: 'MATCHED',
        updateStatus: 'UPDATE_AVAILABLE',
      },
    });

    const job = await prisma.updateJob.create({
      data: {
        applicationId: application.id,
        deviceId: device.id,
        packageId: 'Test.HistoryApp',
        fromVersion: '1.0.0',
        targetVersion: '1.1.0',
        state: 'SUCCEEDED',
        verification: 'VERIFIED',
        verifiedVersion: '1.1.0',
        exitCode: 0,
        initiatedById: userId,
        startedAt: new Date(Date.now() - 60_000),
        finishedAt: new Date(),
      },
    });

    const scan = await prisma.scanJob.create({
      data: { deviceId: device.id, state: 'SUCCEEDED', appCount: 7, requestedById: userId },
    });

    await prisma.auditEvent.create({
      data: {
        actorType: 'USER',
        actorUserId: userId,
        deviceId: device.id,
        eventType: 'SCAN_REQUESTED',
      },
    });
    // Sign-in events must never appear in the activity timeline.
    await prisma.auditEvent.create({
      data: { actorType: 'USER', actorUserId: userId, eventType: 'USER_LOGIN' },
    });

    return { device, application, job, scan };
  }

  it('lists update jobs with the before and after versions', async () => {
    const session = await signedIn();
    const { job } = await deviceWithHistory(session.userId);

    const res = await request(app).get('/api/v1/history?type=update').set('Cookie', session.cookie);

    expect(res.status).toBe(200);
    const body = historyResponseSchema.parse(res.body);
    const row = body.data.find((item) => item.id === job.id);
    expect(row).toBeDefined();
    expect(row?.summary).toBe('History App: 1.0.0 → 1.1.0');
    expect(row?.outcome).toBe('SUCCEEDED');
    expect(row?.actorType).toBe('USER');
    expect(row?.details.verifiedVersion).toBe('1.1.0');
  });

  it('lists scans with the application count', async () => {
    const session = await signedIn();
    const { scan } = await deviceWithHistory(session.userId);

    const res = await request(app).get('/api/v1/history?type=scan').set('Cookie', session.cookie);
    const body = historyResponseSchema.parse(res.body);
    const row = body.data.find((item) => item.id === scan.id);
    expect(row?.summary).toBe('Scan found 7 applications');
    expect(row?.outcome).toBe('SUCCEEDED');
  });

  it('lists activity and never the sign-in noise', async () => {
    const session = await signedIn();
    await deviceWithHistory(session.userId);

    const res = await request(app).get('/api/v1/history?type=audit').set('Cookie', session.cookie);
    const body = historyResponseSchema.parse(res.body);

    expect(body.data.some((item) => item.summary === 'Scan requested')).toBe(true);
    expect(body.data.some((item) => String(item.details.eventType) === 'USER_LOGIN')).toBe(false);
  });

  it('filters by outcome and by device', async () => {
    const session = await signedIn();
    const { device, application } = await deviceWithHistory(session.userId);

    await prisma.updateJob.create({
      data: {
        applicationId: application.id,
        deviceId: device.id,
        packageId: 'Test.HistoryApp',
        fromVersion: '1.1.0',
        targetVersion: '1.2.0',
        state: 'FAILED',
        initiatedById: session.userId,
        finishedAt: new Date(),
      },
    });

    const failed = historyResponseSchema.parse(
      (
        await request(app)
          .get('/api/v1/history?type=update&outcome=FAILED')
          .set('Cookie', session.cookie)
      ).body,
    );
    expect(failed.data).toHaveLength(1);
    expect(failed.data[0].outcome).toBe('FAILED');

    const byDevice = historyResponseSchema.parse(
      (
        await request(app)
          .get(`/api/v1/history?type=update&deviceId=${device.id}`)
          .set('Cookie', session.cookie)
      ).body,
    );
    expect(byDevice.data.every((item) => item.deviceId === device.id)).toBe(true);
  });

  it('never shows another user’s history', async () => {
    const owner = await signedIn();
    const intruder = await signedIn();
    const { job } = await deviceWithHistory(owner.userId);

    const res = await request(app)
      .get('/api/v1/history?type=update')
      .set('Cookie', intruder.cookie);
    const body = historyResponseSchema.parse(res.body);
    expect(body.data.some((item) => item.id === job.id)).toBe(false);
  });

  it('requires a session', async () => {
    expect((await request(app).get('/api/v1/history')).status).toBe(401);
  });
});
