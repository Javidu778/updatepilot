import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

loadEnv({ path: '../../.env', quiet: true });
const hasDatabase = Boolean(process.env.DATABASE_URL && process.env.SESSION_SECRET);
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const PASSWORD = 'Correct-Horse-Battery-9';

describe.skipIf(!hasDatabase)('export routes (database)', () => {
  let prisma: (typeof import('../lib/prisma'))['prisma'];
  let app: express.Express;
  const userIds: string[] = [];
  const deviceIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = await import('../lib/prisma'));
    const { createAuthRouter } = await import('../auth');
    const { exportsRouter } = await import('./exports');
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
    app.use('/api/v1/exports', exportsRouter());
    app.use(notFound);
    app.use(errorHandler);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.auditEvent.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  async function signedIn() {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: `exp-${randomUUID()}@example.test`, password: PASSWORD });
    userIds.push(res.body.user.id);
    const cookie = res.headers['set-cookie'] as unknown as string[];
    return { cookie, csrfToken: res.body.csrfToken as string, userId: res.body.user.id as string };
  }

  /** One device with two applications, one of them carrying a formula-shaped name. */
  async function inventoryFor(userId: string) {
    const device = await prisma.device.create({
      data: { ownerId: userId, name: 'EXPORT-PC', status: 'ACTIVE' },
    });
    deviceIds.push(device.id);

    await prisma.application.createMany({
      data: [
        {
          deviceId: device.id,
          appKey: `pkg:exp.${randomUUID()}`,
          displayName: 'Notepad++',
          publisher: 'Notepad++ Team, Ltd',
          installedVersion: '8.9.7',
          availableVersion: '8.9.9.1',
          packageId: 'Notepad++.Notepad++',
          source: 'winget',
          matchStatus: 'MATCHED',
          updateStatus: 'UPDATE_AVAILABLE',
        },
        {
          deviceId: device.id,
          appKey: `app:exp.${randomUUID()}`,
          displayName: '=HYPERLINK("http://evil.example","click")',
          installedVersion: '1.0',
          matchStatus: 'UNMATCHED',
          updateStatus: 'UNKNOWN',
        },
      ],
    });

    return device;
  }

  it('exports the inventory as CSV with a header row and the real values', async () => {
    const session = await signedIn();
    await inventoryFor(session.userId);

    const res = await request(app)
      .get('/api/v1/exports/applications.csv')
      .set('Cookie', session.cookie);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain(
      'attachment; filename="updatepilot-inventory-',
    );
    expect(res.headers['cache-control']).toBe('no-store');

    const body = res.text;
    expect(body.startsWith('\uFEFF')).toBe(true);
    const lines = body
      .replace(/^\uFEFF/, '')
      .trimEnd()
      .split('\r\n');
    expect(lines[0]).toContain('Device,Application,Publisher');
    expect(body).toContain('EXPORT-PC,Notepad++');
    // A comma in the publisher must not split the row.
    expect(body).toContain('"Notepad++ Team, Ltd"');
    expect(lines).toHaveLength(3);
  });

  it('neutralises a formula in a cell, so opening the file cannot run it', async () => {
    const session = await signedIn();
    await inventoryFor(session.userId);

    const res = await request(app)
      .get('/api/v1/exports/applications.csv')
      .set('Cookie', session.cookie);

    // The cell starts with an apostrophe inside its quotes, not with '='.
    expect(res.text).toContain(`"'=HYPERLINK`);
    expect(res.text).not.toMatch(/(^|,)=HYPERLINK/);
  });

  it('honours the list filters, so the file matches what was on screen', async () => {
    const session = await signedIn();
    await inventoryFor(session.userId);

    const res = await request(app)
      .get('/api/v1/exports/applications.csv?updateStatus=UPDATE_AVAILABLE')
      .set('Cookie', session.cookie);

    expect(res.text).toContain('Notepad++');
    expect(res.text).not.toContain('HYPERLINK');
  });

  it('exports the update history, including the verified before and after versions', async () => {
    const session = await signedIn();
    const device = await inventoryFor(session.userId);
    const application = await prisma.application.findFirstOrThrow({
      where: { deviceId: device.id, packageId: 'Notepad++.Notepad++' },
    });

    await prisma.updateJob.create({
      data: {
        applicationId: application.id,
        deviceId: device.id,
        packageId: 'Notepad++.Notepad++',
        fromVersion: '8.9.7',
        targetVersion: '8.9.9.1',
        state: 'SUCCEEDED',
        verification: 'VERIFIED',
        verifiedVersion: '8.9.9.1',
        exitCode: 0,
        initiatedById: session.userId,
        finishedAt: new Date(),
      },
    });

    const res = await request(app).get('/api/v1/exports/updates.csv').set('Cookie', session.cookie);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Requested,Finished,Device,Application');
    expect(res.text).toContain('Notepad++.Notepad++,8.9.7,8.9.9.1,SUCCEEDED,VERIFIED,8.9.9.1,0,no');
  });

  it('records every export in the audit trail', async () => {
    const session = await signedIn();
    await inventoryFor(session.userId);

    await request(app).get('/api/v1/exports/applications.csv').set('Cookie', session.cookie);

    const events = await prisma.auditEvent.findMany({
      where: { actorUserId: session.userId, eventType: 'EXPORT_CREATED' },
    });
    expect(events).toHaveLength(1);
    expect(events[0].metadata).toMatchObject({
      kind: 'applications',
      rowCount: 2,
      truncated: false,
    });
  });

  it('never exports another user’s inventory', async () => {
    const owner = await signedIn();
    const intruder = await signedIn();
    await inventoryFor(owner.userId);

    const res = await request(app)
      .get('/api/v1/exports/applications.csv')
      .set('Cookie', intruder.cookie);

    expect(res.text).not.toContain('EXPORT-PC');
    expect(
      res.text
        .replace(/^\uFEFF/, '')
        .trimEnd()
        .split('\r\n'),
    ).toHaveLength(1);
  });

  it('requires a session', async () => {
    expect((await request(app).get('/api/v1/exports/applications.csv')).status).toBe(401);
    expect((await request(app).get('/api/v1/exports/updates.csv')).status).toBe(401);
  });
});
