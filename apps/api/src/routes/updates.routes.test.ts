import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { jobSchema, updateCandidateSchema, updatePreviewSchema } from '@updatepilot/shared';

loadEnv({ path: '../../.env', quiet: true });
const hasDatabase = Boolean(process.env.DATABASE_URL && process.env.SESSION_SECRET);
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const PASSWORD = 'Correct-Horse-Battery-9';

describe.skipIf(!hasDatabase)('update routes (database)', () => {
  let prisma: (typeof import('../lib/prisma'))['prisma'];
  let app: express.Express;
  const userIds: string[] = [];
  const deviceIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = await import('../lib/prisma'));
    const { createAuthRouter } = await import('../auth');
    const { updatesRouter } = await import('./updates');
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
    app.use('/api/v1/updates', updatesRouter());
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
      .send({ email: `upd-${randomUUID()}@example.test`, password: PASSWORD });
    userIds.push(res.body.user.id);
    // supertest types the header loosely; the test client wants the array form.
    const cookie = res.headers['set-cookie'] as unknown as string[];
    return { cookie, csrfToken: res.body.csrfToken as string };
  }

  /** A device with three applications: one updatable, one up to date, one unmatched. */
  async function deviceWithApplications(session: { cookie: string[]; csrfToken: string }) {
    const me = await request(app).get('/api/v1/auth/me').set('Cookie', session.cookie);
    const device = await prisma.device.create({
      data: { ownerId: me.body.user.id, name: 'UPD-PC', status: 'ACTIVE' },
    });
    deviceIds.push(device.id);

    const base = {
      deviceId: device.id,
      source: 'winget',
      publisher: null,
      architecture: null,
      lastSeenAt: new Date(),
    };

    const updatable = await prisma.application.create({
      data: {
        ...base,
        appKey: `pkg:test.updatable.${randomUUID()}`,
        displayName: 'Updatable App',
        installedVersion: '1.0.0',
        availableVersion: '1.1.0',
        packageId: `Test.Updatable.${randomUUID()}`,
        matchStatus: 'MATCHED',
        updateStatus: 'UPDATE_AVAILABLE',
      },
    });

    await prisma.application.create({
      data: {
        ...base,
        appKey: `pkg:test.current.${randomUUID()}`,
        displayName: 'Current App',
        installedVersion: '2.0.0',
        availableVersion: '2.0.0',
        packageId: `Test.Current.${randomUUID()}`,
        matchStatus: 'MATCHED',
        updateStatus: 'UP_TO_DATE',
      },
    });

    await prisma.application.create({
      data: {
        ...base,
        appKey: `app:unmatched-${randomUUID()}`,
        displayName: 'Unmatched App',
        installedVersion: '3.0.0',
        availableVersion: '3.1.0',
        packageId: null,
        source: null,
        matchStatus: 'UNMATCHED',
        updateStatus: 'UNKNOWN',
      },
    });

    return { deviceId: device.id, updatable };
  }

  it('lists only applications that can actually be updated', async () => {
    const session = await signedIn();
    await deviceWithApplications(session);

    const res = await request(app).get('/api/v1/updates').set('Cookie', session.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const candidate = updateCandidateSchema.parse(res.body.data[0]);
    expect(candidate.displayName).toBe('Updatable App');
    expect(candidate.activeJobId).toBeNull();
  });

  it('reports an update already in progress instead of offering it again', async () => {
    const session = await signedIn();
    const { updatable } = await deviceWithApplications(session);
    await prisma.updateJob.create({
      data: {
        applicationId: updatable.id,
        deviceId: updatable.deviceId,
        packageId: updatable.packageId!,
        fromVersion: updatable.installedVersion,
        targetVersion: updatable.availableVersion!,
        state: 'QUEUED',
      },
    });

    const res = await request(app).get('/api/v1/updates').set('Cookie', session.cookie);
    expect(updateCandidateSchema.parse(res.body.data[0]).activeJobId).not.toBeNull();
  });

  it('previews an update, binding the token to what was shown', async () => {
    const session = await signedIn();
    const { updatable } = await deviceWithApplications(session);

    const res = await request(app)
      .post(`/api/v1/updates/${updatable.id}/preview`)
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrfToken);

    expect(res.status).toBe(200);
    const preview = updatePreviewSchema.parse(res.body);
    expect(preview.fromVersion).toBe('1.0.0');
    expect(preview.targetVersion).toBe('1.1.0');
    expect(preview.packageId).toBe(updatable.packageId);
    expect(preview.mayRequireElevation).toBe(true);

    const minutes = (Date.parse(preview.expiresAt) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(9);
    expect(minutes).toBeLessThanOrEqual(10);

    // The token is stored as a hash, unused, and bound to this application and target version.
    const stored = await prisma.previewToken.findFirstOrThrow({
      where: { applicationId: updatable.id },
    });
    expect(stored.tokenHash).not.toBe(preview.previewToken);
    expect(stored.tokenHash).toHaveLength(64);
    expect(stored.usedAt).toBeNull();
    expect(stored.targetVersion).toBe('1.1.0');
    expect(stored.fromVersion).toBe('1.0.0');

    expect(preview.notes.join(' ')).toContain('permission');
  });

  it('refuses to preview an application that is already up to date', async () => {
    const session = await signedIn();
    const { deviceId } = await deviceWithApplications(session);
    const current = await prisma.application.findFirstOrThrow({
      where: { deviceId, updateStatus: 'UP_TO_DATE' },
    });

    const res = await request(app)
      .post(`/api/v1/updates/${current.id}/preview`)
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrfToken);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  it('refuses to preview while an update is in progress', async () => {
    const session = await signedIn();
    const { updatable } = await deviceWithApplications(session);
    await prisma.updateJob.create({
      data: {
        applicationId: updatable.id,
        deviceId: updatable.deviceId,
        packageId: updatable.packageId!,
        fromVersion: updatable.installedVersion,
        targetVersion: updatable.availableVersion!,
        state: 'RUNNING',
      },
    });

    const res = await request(app)
      .post(`/api/v1/updates/${updatable.id}/preview`)
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrfToken);

    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('already in progress');
  });

  it('does not let one user preview another user’s application', async () => {
    const owner = await signedIn();
    const intruder = await signedIn();
    const { updatable } = await deviceWithApplications(owner);

    const res = await request(app)
      .post(`/api/v1/updates/${updatable.id}/preview`)
      .set('Cookie', intruder.cookie)
      .set('X-CSRF-Token', intruder.csrfToken);

    expect(res.status).toBe(404);
  });

  it('requires a session and a CSRF token', async () => {
    const session = await signedIn();
    const { updatable } = await deviceWithApplications(session);

    expect((await request(app).get('/api/v1/updates')).status).toBe(401);
    expect(
      (
        await request(app)
          .post(`/api/v1/updates/${updatable.id}/preview`)
          .set('Cookie', session.cookie)
      ).status,
    ).toBe(403);
  });

  async function previewFor(
    session: { cookie: string[]; csrfToken: string },
    applicationId: string,
  ) {
    const res = await request(app)
      .post(`/api/v1/updates/${applicationId}/preview`)
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrfToken);
    return updatePreviewSchema.parse(res.body);
  }

  const execute = (
    session: { cookie: string[]; csrfToken: string },
    applicationId: string,
    previewToken: string,
    withCsrf = true,
  ) => {
    const call = request(app)
      .post(`/api/v1/updates/${applicationId}/execute`)
      .set('Cookie', session.cookie);
    return (withCsrf ? call.set('X-CSRF-Token', session.csrfToken) : call).send({ previewToken });
  };

  it('queues an update from a confirmed preview and spends the token', async () => {
    const session = await signedIn();
    const { updatable } = await deviceWithApplications(session);
    const preview = await previewFor(session, updatable.id);

    const res = await execute(session, updatable.id, preview.previewToken);

    expect(res.status).toBe(202);
    const job = jobSchema.parse(res.body);
    expect(job.kind).toBe('update');
    expect(job.state).toBe('QUEUED');
    expect(job.packageId).toBe(updatable.packageId);
    expect(job.fromVersion).toBe('1.0.0');
    expect(job.targetVersion).toBe('1.1.0');

    const token = await prisma.previewToken.findFirstOrThrow({
      where: { applicationId: updatable.id },
    });
    expect(token.usedAt).not.toBeNull();
  });

  it('refuses a token that was already spent', async () => {
    const session = await signedIn();
    const { updatable } = await deviceWithApplications(session);
    const preview = await previewFor(session, updatable.id);

    expect((await execute(session, updatable.id, preview.previewToken)).status).toBe(202);

    const second = await execute(session, updatable.id, preview.previewToken);
    expect(second.status).toBe(422);
    expect(second.body.error.code).toBe('UPDATE_CHANGED');

    const jobs = await prisma.updateJob.count({ where: { applicationId: updatable.id } });
    expect(jobs).toBe(1);
  });

  it('refuses when the update changed since the preview', async () => {
    const session = await signedIn();
    const { updatable } = await deviceWithApplications(session);
    const preview = await previewFor(session, updatable.id);

    // A newer version appeared while the dialog was open.
    await prisma.application.update({
      where: { id: updatable.id },
      data: { availableVersion: '1.2.0' },
    });

    const res = await execute(session, updatable.id, preview.previewToken);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('UPDATE_CHANGED');
    expect(await prisma.updateJob.count({ where: { applicationId: updatable.id } })).toBe(0);
  });

  it('does not let another user execute a preview', async () => {
    const owner = await signedIn();
    const intruder = await signedIn();
    const { updatable } = await deviceWithApplications(owner);
    const preview = await previewFor(owner, updatable.id);

    const res = await execute(intruder, updatable.id, preview.previewToken);
    expect(res.status).toBe(404);
  });

  it('requires a CSRF token to execute', async () => {
    const session = await signedIn();
    const { updatable } = await deviceWithApplications(session);
    const preview = await previewFor(session, updatable.id);

    expect((await execute(session, updatable.id, preview.previewToken, false)).status).toBe(403);
  });
});
