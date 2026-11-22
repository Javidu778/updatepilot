import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { securityFindingsResponseSchema } from '@updatepilot/shared';

loadEnv({ path: '../../.env', quiet: true });
const hasDatabase = Boolean(process.env.DATABASE_URL && process.env.SESSION_SECRET);
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const PASSWORD = 'Correct-Horse-Battery-9';

describe.skipIf(!hasDatabase)('security routes (database)', () => {
  let prisma: (typeof import('../lib/prisma'))['prisma'];
  let app: express.Express;
  const userIds: string[] = [];
  const deviceIds: string[] = [];
  const packageIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = await import('../lib/prisma'));
    const { createAuthRouter } = await import('../auth');
    const { securityRouter } = await import('./security');
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
    app.use('/api/v1/security', securityRouter());
    app.use(notFound);
    app.use(errorHandler);
  });

  afterAll(async () => {
    if (!prisma) return;
    // Only rows this suite created: the package ids are random per run.
    await prisma.securityFinding.deleteMany({ where: { packageId: { in: packageIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  async function signedIn() {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: `sec-${randomUUID()}@example.test`, password: PASSWORD });
    userIds.push(res.body.user.id);
    const cookie = res.headers['set-cookie'] as unknown as string[];
    return { cookie, userId: res.body.user.id as string };
  }

  /** A device with one installed package, plus a finding for it and one for a package nobody has. */
  async function deviceWithFinding(userId: string) {
    const suffix = randomUUID().slice(0, 8);
    const installedPackage = `Test.Installed.${suffix}`;
    const otherPackage = `Test.Other.${suffix}`;
    packageIds.push(installedPackage, otherPackage);

    const device = await prisma.device.create({
      data: { ownerId: userId, name: 'SEC-PC', status: 'ACTIVE' },
    });
    deviceIds.push(device.id);

    await prisma.application.create({
      data: {
        deviceId: device.id,
        appKey: `pkg:${installedPackage.toLowerCase()}`,
        displayName: 'Installed App',
        installedVersion: '1.0.0',
        availableVersion: '1.1.0',
        packageId: installedPackage,
        source: 'winget',
        matchStatus: 'MATCHED',
        updateStatus: 'UPDATE_AVAILABLE',
      },
    });

    const finding = await prisma.securityFinding.create({
      data: {
        packageId: installedPackage,
        advisoryId: `ADV-${suffix}`,
        severity: 'HIGH',
        summary: 'Test advisory',
        affectedRange: '< 1.1.0',
        fixedVersion: '1.1.0',
        source: 'test',
        lastVerifiedAt: new Date(),
        isSample: false,
      },
    });

    await prisma.securityFinding.create({
      data: {
        packageId: otherPackage,
        advisoryId: `ADV-OTHER-${suffix}`,
        severity: 'CRITICAL',
        affectedRange: '< 9',
        source: 'test',
        lastVerifiedAt: new Date(),
        isSample: false,
      },
    });

    return { device, finding, installedPackage, otherPackage };
  }

  it('lists findings only for packages the user actually has', async () => {
    const session = await signedIn();
    const { finding, otherPackage } = await deviceWithFinding(session.userId);

    const res = await request(app).get('/api/v1/security/findings').set('Cookie', session.cookie);

    expect(res.status).toBe(200);
    const body = securityFindingsResponseSchema.parse(res.body);
    expect(body.data.map((row) => row.id)).toContain(finding.id);
    expect(body.data.some((row) => row.packageId === otherPackage)).toBe(false);
    expect(body.meta.limitations).toContain('does not prove');
    expect(body.meta.isSample).toBe(false);
  });

  it('filters by severity and by package', async () => {
    const session = await signedIn();
    const { installedPackage } = await deviceWithFinding(session.userId);

    const onlyLow = securityFindingsResponseSchema.parse(
      (
        await request(app)
          .get('/api/v1/security/findings?severity=LOW')
          .set('Cookie', session.cookie)
      ).body,
    );
    expect(onlyLow.data).toHaveLength(0);

    const byPackage = securityFindingsResponseSchema.parse(
      (
        await request(app)
          .get(`/api/v1/security/findings?packageId=${installedPackage}`)
          .set('Cookie', session.cookie)
      ).body,
    );
    expect(byPackage.data).toHaveLength(1);
    expect(byPackage.data[0].packageId).toBe(installedPackage);
  });

  it('says plainly when the rows are sample data', async () => {
    const session = await signedIn();
    const { installedPackage } = await deviceWithFinding(session.userId);
    await prisma.securityFinding.updateMany({
      where: { packageId: installedPackage },
      data: { isSample: true },
    });

    const body = securityFindingsResponseSchema.parse(
      (await request(app).get('/api/v1/security/findings').set('Cookie', session.cookie)).body,
    );
    expect(body.meta.isSample).toBe(true);
    expect(body.meta.source).toBe('Sample data');
  });

  it('returns an explicit empty answer for a user with no matched packages', async () => {
    const session = await signedIn();

    const body = securityFindingsResponseSchema.parse(
      (await request(app).get('/api/v1/security/findings').set('Cookie', session.cookie)).body,
    );
    expect(body.total).toBe(0);
    expect(body.meta.limitations).toContain('nothing to check');
  });

  it('never shows another user’s packages', async () => {
    const owner = await signedIn();
    const intruder = await signedIn();
    const { finding } = await deviceWithFinding(owner.userId);

    const body = securityFindingsResponseSchema.parse(
      (await request(app).get('/api/v1/security/findings').set('Cookie', intruder.cookie)).body,
    );
    expect(body.data.some((row) => row.id === finding.id)).toBe(false);
  });

  it('requires a session', async () => {
    expect((await request(app).get('/api/v1/security/findings')).status).toBe(401);
  });
});
