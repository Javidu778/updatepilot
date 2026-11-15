import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { pairResponseSchema, pairingCodeResponseSchema } from '@updatepilot/shared';

/** Integration tests: real HTTP against a real database. Skipped without DATABASE_URL + SESSION_SECRET. */
loadEnv({ path: '../../.env', quiet: true });
const hasDatabase = Boolean(process.env.DATABASE_URL && process.env.SESSION_SECRET);
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const PASSWORD = 'Correct-Horse-Battery-9';

describe.skipIf(!hasDatabase)('pairing routes (database)', () => {
  let prisma: (typeof import('../lib/prisma'))['prisma'];
  let app: express.Express;
  const userIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = await import('../lib/prisma'));
    const { createAuthRouter } = await import('../auth');
    const { devicesRouter } = await import('./devices');
    const { errorHandler } = await import('../middleware/error-handler');
    const { notFound } = await import('../middleware/not-found');

    const quietLog = { error: () => undefined, info: () => undefined };
    app = express();
    app.use((req, _res, next) => {
      Object.assign(req, { id: randomUUID(), log: quietLog });
      next();
    });
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/v1/auth', createAuthRouter({ registerLimit: 10_000 }));
    app.use('/api/v1/devices', devicesRouter());
    app.use(notFound);
    app.use(errorHandler);
  });

  afterAll(async () => {
    if (!prisma) return;
    const devices = await prisma.device.findMany({
      where: { ownerId: { in: userIds } },
      select: { id: true },
    });
    const deviceIds = devices.map((device) => device.id);
    await prisma.auditEvent.deleteMany({
      where: { OR: [{ actorUserId: { in: userIds } }, { deviceId: { in: deviceIds } }] },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  /** Registers a throwaway user and returns the cookie plus CSRF token for it. */
  async function signIn() {
    const email = `pair-${randomUUID()}@example.test`;
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD });
    expect(res.status).toBe(201);
    userIds.push(res.body.user.id);
    const cookie = res.headers['set-cookie'];
    return { cookie, csrfToken: res.body.csrfToken as string, userId: res.body.user.id as string };
  }

  async function requestCode(session: Awaited<ReturnType<typeof signIn>>) {
    const res = await request(app)
      .post('/api/v1/devices/pairing-codes')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrfToken);
    expect(res.status).toBe(201);
    return pairingCodeResponseSchema.parse(res.body);
  }

  it('creates a code that matches the contract and expires in ten minutes', async () => {
    const session = await signIn();
    const body = await requestCode(session);

    expect(body.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const minutes = (Date.parse(body.expiresAt) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(9);
    expect(minutes).toBeLessThanOrEqual(10);
  });

  it('requires a session and a CSRF token to create a code', async () => {
    const session = await signIn();

    const anonymous = await request(app).post('/api/v1/devices/pairing-codes');
    expect(anonymous.status).toBe(401);

    const noCsrf = await request(app)
      .post('/api/v1/devices/pairing-codes')
      .set('Cookie', session.cookie);
    expect(noCsrf.status).toBe(403);
  });

  it('exchanges a code for a device and a token, storing only hashes', async () => {
    const session = await signIn();
    const { code } = await requestCode(session);

    const res = await request(app).post('/api/v1/devices/pair').send({
      pairingCode: code,
      deviceName: 'DESKTOP-TEST',
      osVersion: 'Windows 11',
      agentVersion: '0.1.0',
    });

    expect(res.status).toBe(201);
    const body = pairResponseSchema.parse(res.body);
    expect(body.pollIntervalSeconds).toBeGreaterThanOrEqual(1);

    const device = await prisma.device.findUniqueOrThrow({
      where: { id: body.deviceId },
      include: { credentials: true },
    });
    expect(device.status).toBe('ACTIVE');
    expect(device.ownerId).toBe(session.userId);
    expect(device.name).toBe('DESKTOP-TEST');
    expect(device.credentials).toHaveLength(1);
    expect(device.credentials[0].tokenHash).not.toBe(body.agentToken);
    expect(device.credentials[0].tokenHash).toHaveLength(64);

    const storedCode = await prisma.pairingCode.findFirstOrThrow({
      where: { userId: session.userId },
    });
    expect(storedCode.usedAt).not.toBeNull();
    expect(storedCode.codeHash).not.toContain(code);
  });

  it('refuses a code that was already used', async () => {
    const session = await signIn();
    const { code } = await requestCode(session);

    const first = await request(app)
      .post('/api/v1/devices/pair')
      .send({ pairingCode: code, deviceName: 'A' });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/v1/devices/pair')
      .send({ pairingCode: code, deviceName: 'B' });
    expect(second.status).toBe(404);
    expect(second.body.error.code).toBe('NOT_FOUND');
  });

  it('gives the same answer for an unknown code and an expired one', async () => {
    const session = await signIn();
    const { code } = await requestCode(session);

    const unknown = await request(app)
      .post('/api/v1/devices/pair')
      .send({ pairingCode: 'ZZZZ-ZZZZ', deviceName: 'A' });
    expect(unknown.status).toBe(404);

    await prisma.pairingCode.updateMany({
      where: { userId: session.userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await request(app)
      .post('/api/v1/devices/pair')
      .send({ pairingCode: code, deviceName: 'A' });
    expect(expired.status).toBe(404);
    expect(expired.body.error.message).toBe(unknown.body.error.message);
  });

  it('rejects a malformed code and extra fields', async () => {
    const malformed = await request(app)
      .post('/api/v1/devices/pair')
      .send({ pairingCode: 'abc', deviceName: 'A' });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');

    const extra = await request(app)
      .post('/api/v1/devices/pair')
      .send({ pairingCode: 'ABCD-1234', deviceName: 'A', runCommand: 'calc.exe' });
    expect(extra.status).toBe(400);
  });

  it('records both audit events without storing secrets', async () => {
    const session = await signIn();
    const { code } = await requestCode(session);
    await request(app)
      .post('/api/v1/devices/pair')
      .send({ pairingCode: code, deviceName: 'AUDIT-PC' });

    const events = await prisma.auditEvent.findMany({
      where: { OR: [{ actorUserId: session.userId }, { deviceId: { not: null } }] },
      orderBy: { createdAt: 'asc' },
    });
    const types = events.map((event) => event.eventType);
    expect(types).toContain('DEVICE_PAIRING_CODE_CREATED');
    expect(types).toContain('DEVICE_PAIRED');

    const paired = events.find((event) => event.eventType === 'DEVICE_PAIRED');
    expect(JSON.stringify(paired?.metadata)).not.toContain(code);
  });
});
