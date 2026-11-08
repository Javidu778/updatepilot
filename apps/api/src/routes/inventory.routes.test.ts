import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  applicationDetailSchema,
  applicationsResponseSchema,
  dashboardSchema,
  devicesResponseSchema,
} from '@updatepilot/shared';

/**
 * Integration tests: real HTTP requests against a real PostgreSQL database.
 * Every response is also checked against the shared contract schemas, so the API cannot
 * drift away from docs/openapi.yaml without a test failing.
 *
 * They need DATABASE_URL and SESSION_SECRET. Without them the suite is skipped.
 * All rows are created for throwaway @example.test users and removed afterwards.
 */
loadEnv({ path: '../../.env', quiet: true });
const hasDatabase = Boolean(process.env.DATABASE_URL && process.env.SESSION_SECRET);

// Real database calls on a slow machine (Docker on Windows) can take longer than the 5 s default.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const PASSWORD = 'Correct-Horse-Battery-9';
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
const names = (res: { body: { data: { displayName: string }[] } }) =>
  res.body.data.map((a) => a.displayName);

describe.skipIf(!hasDatabase)('inventory routes (database)', () => {
  let prisma: (typeof import('../lib/prisma'))['prisma'];
  let app: express.Express;
  const userIds: string[] = [];
  const packageIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = await import('../lib/prisma'));
    const { createAuthRouter } = await import('../auth');
    const { devicesRouter } = await import('./devices');
    const { dashboardRouter } = await import('./dashboard');
    const { applicationsRouter } = await import('./applications');
    const { errorHandler } = await import('../middleware/error-handler');
    const { notFound } = await import('../middleware/not-found');

    const quietLog = { error: () => undefined, info: () => undefined };
    app = express();
    // The real app (app.ts) gets these from pino-http and a global body parser.
    app.use((req, _res, next) => {
      Object.assign(req, { id: randomUUID(), log: quietLog });
      next();
    });
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/v1/auth', createAuthRouter({ registerLimit: 10_000 }));
    app.use('/api/v1/devices', devicesRouter());
    app.use('/api/v1/dashboard', dashboardRouter());
    app.use('/api/v1/applications', applicationsRouter());
    app.use(notFound);
    app.use(errorHandler);
  });

  afterAll(async () => {
    if (!prisma) return;
    const devices = await prisma.device.findMany({
      where: { ownerId: { in: userIds } },
      select: { id: true },
    });
    const deviceIds = devices.map((d) => d.id);
    // Deleting a user keeps their audit events (actor set to null), so remove them first.
    await prisma.auditEvent.deleteMany({
      where: {
        OR: [
          { actorUserId: { in: userIds } },
          { targetId: { in: userIds } },
          { deviceId: { in: deviceIds } },
        ],
      },
    });
    await prisma.releaseMetadata.deleteMany({ where: { packageId: { in: packageIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  /** Creates a throwaway account and returns a signed-in agent. */
  const signUp = async () => {
    const agent = request.agent(app);
    const res = await agent
      .post('/api/v1/auth/register')
      .send({ email: `test-${randomUUID()}@example.test`, password: PASSWORD });
    expect(res.status).toBe(201);
    userIds.push(res.body.user.id);
    return { agent, userId: res.body.user.id as string };
  };

  const makeDevice = (ownerId: string, data: Record<string, unknown> = {}) =>
    prisma.device.create({
      data: { ownerId, name: 'Test PC', status: 'ACTIVE', lastSeenAt: new Date(), ...data },
    });

  const makeApp = (deviceId: string, data: Record<string, unknown> = {}) =>
    prisma.application.create({
      data: {
        deviceId,
        appKey: `key-${randomUUID()}`,
        displayName: 'app',
        installedVersion: '1.0',
        ...data,
      },
    });

  /** n applications named app-01 .. app-nn; even numbers have an update available. */
  const makeManyApps = async (deviceId: string, n = 30) => {
    await prisma.application.createMany({
      data: Array.from({ length: n }, (_, index) => ({
        deviceId,
        appKey: `key-${randomUUID()}`,
        displayName: `app-${String(index + 1).padStart(2, '0')}`,
        installedVersion: '1.0',
        updateStatus:
          (index + 1) % 2 === 0 ? ('UPDATE_AVAILABLE' as const) : ('UP_TO_DATE' as const),
      })),
    });
  };

  describe('authentication', () => {
    it.each([
      '/api/v1/devices',
      '/api/v1/dashboard',
      '/api/v1/applications',
      `/api/v1/applications/${randomUUID()}`,
    ])('GET %s needs a login', async (url) => {
      const res = await request(app).get(url);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('unknown routes still return 404, not 401', async () => {
      expect((await request(app).get('/api/v1/nope')).status).toBe(404);
    });

    it('marks private responses as not cacheable', async () => {
      const { agent } = await signUp();
      for (const url of ['/api/v1/devices', '/api/v1/dashboard', '/api/v1/applications']) {
        const res = await agent.get(url);
        expect(res.headers['cache-control']).toBe('no-store');
      }
    });
  });

  describe('GET /devices', () => {
    it('returns only the signed-in user’s devices, in the shared format', async () => {
      const a = await signUp();
      const b = await signUp();
      const mine = await makeDevice(a.userId, { name: 'Alice PC' });
      await makeDevice(b.userId, { name: 'Bob PC' });

      const res = await a.agent.get('/api/v1/devices');
      expect(res.status).toBe(200);
      expect(() => devicesResponseSchema.parse(res.body)).not.toThrow();
      expect(res.body.data.map((d: { id: string }) => d.id)).toEqual([mine.id]);
      expect(JSON.stringify(res.body)).not.toContain('Bob PC');
    });

    it('works out the connection state from status and last-seen time', async () => {
      const { agent, userId } = await signUp();
      const cases: [string, Record<string, unknown>, string][] = [
        ['pending', { status: 'PENDING', lastSeenAt: null }, 'pending'],
        ['revoked', { status: 'REVOKED' }, 'revoked'],
        ['connected', { lastSeenAt: new Date() }, 'connected'],
        ['stale', { lastSeenAt: minutesAgo(5) }, 'stale'],
        ['gone', { lastSeenAt: minutesAgo(120) }, 'disconnected'],
        ['never', { lastSeenAt: null }, 'disconnected'],
      ];
      for (const [name, data] of cases) await makeDevice(userId, { name, ...data });

      const res = await agent.get('/api/v1/devices');
      const byName = Object.fromEntries(
        res.body.data.map((d: { name: string; connection: string }) => [d.name, d.connection]),
      );
      for (const [name, , expected] of cases) expect(byName[name]).toBe(expected);
    });

    it('returns an empty list for a user with no devices', async () => {
      const { agent } = await signUp();
      const res = await agent.get('/api/v1/devices');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('does not expose internal columns', async () => {
      const { agent, userId } = await signUp();
      await makeDevice(userId);
      const device = (await agent.get('/api/v1/devices')).body.data[0];
      expect(Object.keys(device).sort()).toEqual(
        [
          'agentVersion',
          'connection',
          'id',
          'isSample',
          'lastSeenAt',
          'name',
          'osVersion',
          'status',
        ].sort(),
      );
    });
  });

  describe('GET /dashboard', () => {
    it('is all zeros for a new user and says no agent is paired', async () => {
      const { agent } = await signUp();
      const res = await agent.get('/api/v1/dashboard');
      expect(res.status).toBe(200);
      expect(() => dashboardSchema.parse(res.body)).not.toThrow();
      expect(res.body).toMatchObject({
        isSample: false,
        counts: { applications: 0, updatesAvailable: 0, unmatched: 0, unsupported: 0 },
        lastScanAt: null,
        agent: { connection: 'pending', deviceId: null, lastSeenAt: null },
        recentActivity: [],
      });
    });

    it('counts across all of the user’s devices, skips removed apps and other users', async () => {
      const a = await signUp();
      const b = await signUp();
      const d1 = await makeDevice(a.userId);
      const d2 = await makeDevice(a.userId, { name: 'Second PC' });
      const other = await makeDevice(b.userId);

      await makeApp(d1.id, { updateStatus: 'UPDATE_AVAILABLE', matchStatus: 'MATCHED' });
      await makeApp(d1.id, { updateStatus: 'UP_TO_DATE', matchStatus: 'MATCHED' });
      await makeApp(d1.id, { matchStatus: 'UNMATCHED' });
      await makeApp(d2.id, { updateStatus: 'UPDATE_AVAILABLE', matchStatus: 'MATCHED' });
      await makeApp(d2.id, { matchStatus: 'UNSUPPORTED' });
      await makeApp(d2.id, { updateStatus: 'UPDATE_AVAILABLE', removedAt: new Date() }); // removed
      await makeApp(other.id, { updateStatus: 'UPDATE_AVAILABLE', matchStatus: 'UNMATCHED' }); // someone else's

      const res = await a.agent.get('/api/v1/dashboard');
      expect(res.body.counts).toEqual({
        applications: 5,
        updatesAvailable: 2,
        unmatched: 1,
        unsupported: 1,
      });
    });

    it('flags sample data when any sample device is included', async () => {
      const { agent, userId } = await signUp();
      await makeDevice(userId, { isSample: false });
      expect((await agent.get('/api/v1/dashboard')).body.isSample).toBe(false);
      await makeDevice(userId, { name: 'SAMPLE', isSample: true });
      expect((await agent.get('/api/v1/dashboard')).body.isSample).toBe(true);
    });

    it('uses the latest successful scan only', async () => {
      const { agent, userId } = await signUp();
      const device = await makeDevice(userId);
      const older = minutesAgo(60);
      const newest = minutesAgo(30);
      await prisma.scanJob.create({
        data: { deviceId: device.id, state: 'SUCCEEDED', finishedAt: older },
      });
      await prisma.scanJob.create({
        data: { deviceId: device.id, state: 'SUCCEEDED', finishedAt: newest },
      });
      await prisma.scanJob.create({
        data: { deviceId: device.id, state: 'FAILED', finishedAt: minutesAgo(1) },
      });

      const res = await agent.get('/api/v1/dashboard');
      expect(res.body.lastScanAt).toBe(newest.toISOString());
    });

    it('shows the most recently seen device that is not revoked as the agent', async () => {
      const { agent, userId } = await signUp();
      await makeDevice(userId, { name: 'old', lastSeenAt: minutesAgo(300) });
      const fresh = await makeDevice(userId, { name: 'fresh', lastSeenAt: new Date() });
      await makeDevice(userId, { name: 'revoked', status: 'REVOKED', lastSeenAt: new Date() });

      const res = await agent.get('/api/v1/dashboard');
      expect(res.body.agent.deviceId).toBe(fresh.id);
      expect(res.body.agent.connection).toBe('connected');
    });

    it('falls back to a revoked device when it is the only one', async () => {
      const { agent, userId } = await signUp();
      const only = await makeDevice(userId, { status: 'REVOKED' });
      const res = await agent.get('/api/v1/dashboard');
      expect(res.body.agent).toMatchObject({ deviceId: only.id, connection: 'revoked' });
    });

    it('lists the newest 10 relevant events, without sign-in noise or other users’ events', async () => {
      const a = await signUp();
      const b = await signUp();
      const mine = await makeDevice(a.userId);
      const theirs = await makeDevice(b.userId);

      for (let i = 0; i < 12; i++) {
        await prisma.auditEvent.create({
          data: {
            actorType: 'AGENT',
            deviceId: mine.id,
            eventType: 'SCAN_COMPLETED',
            metadata: { note: 'internal detail that must not be shown' },
            createdAt: minutesAgo(100 - i),
          },
        });
      }
      await prisma.auditEvent.create({
        data: { actorType: 'AGENT', deviceId: theirs.id, eventType: 'UPDATE_FAILED' },
      });
      await prisma.auditEvent.create({
        data: { actorType: 'USER', actorUserId: a.userId, eventType: 'USER_LOGIN' },
      });

      const res = await a.agent.get('/api/v1/dashboard');
      expect(() => dashboardSchema.parse(res.body)).not.toThrow();
      const feed = res.body.recentActivity;
      expect(feed).toHaveLength(10);
      expect(feed.every((e: { eventType: string }) => e.eventType === 'SCAN_COMPLETED')).toBe(true);
      const times = feed.map((e: { timestamp: string }) => Date.parse(e.timestamp));
      expect([...times].sort((x, y) => y - x)).toEqual(times); // newest first
      expect(JSON.stringify(res.body)).not.toContain('internal detail');
      expect(feed[0].summary).toBe('Scan completed');
    });
  });

  describe('GET /applications', () => {
    it('returns only the user’s own applications', async () => {
      const a = await signUp();
      const b = await signUp();
      const da = await makeDevice(a.userId);
      const db = await makeDevice(b.userId);
      await makeApp(da.id, { displayName: 'alice-app' });
      await makeApp(db.id, { displayName: 'bob-app' });

      const res = await a.agent.get('/api/v1/applications');
      expect(res.status).toBe(200);
      expect(() => applicationsResponseSchema.parse(res.body)).not.toThrow();
      expect(names(res)).toEqual(['alice-app']);
      expect(res.body.total).toBe(1);
    });

    it('does not let a deviceId filter reach another user’s device', async () => {
      const a = await signUp();
      const b = await signUp();
      const db = await makeDevice(b.userId);
      await makeApp(db.id, { displayName: 'bob-app' });

      const res = await a.agent.get(`/api/v1/applications?deviceId=${db.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('paginates with correct totals', async () => {
      const { agent, userId } = await signUp();
      await makeManyApps((await makeDevice(userId)).id, 30);

      const first = await agent.get('/api/v1/applications');
      expect(first.body).toMatchObject({ page: 1, pageSize: 25, total: 30, totalPages: 2 });
      expect(first.body.data).toHaveLength(25);

      const second = await agent.get('/api/v1/applications?page=2');
      expect(second.body.data).toHaveLength(5);

      const small = await agent.get('/api/v1/applications?pageSize=7&page=5');
      expect(small.body).toMatchObject({ page: 5, pageSize: 7, total: 30, totalPages: 5 });
      expect(small.body.data).toHaveLength(2);
    });

    it('returns an empty page, not an error, past the last page or absurdly far', async () => {
      const { agent, userId } = await signUp();
      await makeManyApps((await makeDevice(userId)).id, 3);
      for (const page of ['99', '1000000', '99999999999']) {
        const res = await agent.get(`/api/v1/applications?page=${page}`);
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([]);
        expect(res.body.total).toBe(3);
      }
    });

    it('sorts by name in both directions', async () => {
      const { agent, userId } = await signUp();
      await makeManyApps((await makeDevice(userId)).id, 5);
      expect(names(await agent.get('/api/v1/applications?sort=displayName&order=asc'))).toEqual([
        'app-01',
        'app-02',
        'app-03',
        'app-04',
        'app-05',
      ]);
      expect(names(await agent.get('/api/v1/applications?sort=displayName&order=desc'))).toEqual([
        'app-05',
        'app-04',
        'app-03',
        'app-02',
        'app-01',
      ]);
    });

    it('sorts by installed version', async () => {
      const { agent, userId } = await signUp();
      const device = await makeDevice(userId);
      await makeApp(device.id, { displayName: 'b', installedVersion: '2.0' });
      await makeApp(device.id, { displayName: 'a', installedVersion: '3.0' });
      await makeApp(device.id, { displayName: 'c', installedVersion: '1.0' });
      expect(
        names(await agent.get('/api/v1/applications?sort=installedVersion&order=asc')),
      ).toEqual(['c', 'b', 'a']);
    });

    it('keeps paging stable when many rows share the same sort value', async () => {
      const { agent, userId } = await signUp();
      const device = await makeDevice(userId);
      const rows = await prisma.application.createManyAndReturn({
        data: Array.from({ length: 10 }, () => ({
          deviceId: device.id,
          appKey: `key-${randomUUID()}`,
          displayName: 'same',
          installedVersion: '1.0',
        })),
        select: { id: true },
      });
      const created = rows.map((row) => row.id);

      const seen: string[] = [];
      for (let page = 1; page <= 4; page++) {
        const res = await agent.get(
          `/api/v1/applications?sort=displayName&pageSize=3&page=${page}`,
        );
        seen.push(...res.body.data.map((a: { id: string }) => a.id));
      }
      expect(seen).toHaveLength(10);
      expect(new Set(seen).size).toBe(10); // no row repeated
      expect([...seen].sort()).toEqual([...created].sort()); // no row skipped
    });

    it('searches name, publisher and package id, ignoring case', async () => {
      const { agent, userId } = await signUp();
      const device = await makeDevice(userId);
      await makeApp(device.id, {
        displayName: 'Notepad++',
        publisher: 'Don Ho',
        packageId: 'Notepad++.Notepad++',
      });
      await makeApp(device.id, {
        displayName: 'VLC',
        publisher: 'VideoLAN',
        packageId: 'VideoLAN.VLC',
      });
      await makeApp(device.id, {
        displayName: 'Git',
        publisher: 'The Git Community',
        packageId: 'Git.Git',
      });

      expect(names(await agent.get('/api/v1/applications?q=notepad'))).toEqual(['Notepad++']); // name
      expect(names(await agent.get('/api/v1/applications?q=VIDEOLAN'))).toEqual(['VLC']); // publisher
      expect(names(await agent.get('/api/v1/applications?q=git.git'))).toEqual(['Git']); // package id
      expect((await agent.get('/api/v1/applications?q=nothing-matches')).body.total).toBe(0);
    });

    it('treats % and _ in a search as plain characters', async () => {
      const { agent, userId } = await signUp();
      const device = await makeDevice(userId);
      await makeApp(device.id, { displayName: 'Plain App' });
      await makeApp(device.id, { displayName: '100% Done' });
      await makeApp(device.id, { displayName: 'snake_case' });
      await makeApp(device.id, { displayName: 'back\\slash' });

      expect(names(await agent.get('/api/v1/applications?q=%25'))).toEqual(['100% Done']);
      expect(names(await agent.get('/api/v1/applications?q=_'))).toEqual(['snake_case']);
      expect(names(await agent.get('/api/v1/applications?q=%5C'))).toEqual(['back\\slash']);
    });

    it('is not affected by SQL in the search text', async () => {
      const { agent, userId } = await signUp();
      await makeApp((await makeDevice(userId)).id, { displayName: 'keep-me' });

      const res = await agent.get(
        `/api/v1/applications?q=${encodeURIComponent(`'; DROP TABLE "Application"; --`)}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
      expect((await agent.get('/api/v1/applications')).body.total).toBe(1); // table still there
    });

    it('filters by update status, match status and source', async () => {
      const { agent, userId } = await signUp();
      const device = await makeDevice(userId);
      await makeApp(device.id, {
        displayName: 'u',
        updateStatus: 'UPDATE_AVAILABLE',
        matchStatus: 'MATCHED',
        source: 'winget',
      });
      await makeApp(device.id, {
        displayName: 'm',
        updateStatus: 'UP_TO_DATE',
        matchStatus: 'MATCHED',
        source: 'winget',
      });
      await makeApp(device.id, { displayName: 'x', matchStatus: 'UNMATCHED', source: null });
      await makeApp(device.id, { displayName: 's', matchStatus: 'UNSUPPORTED', source: 'other' });

      expect(names(await agent.get('/api/v1/applications?updateStatus=UPDATE_AVAILABLE'))).toEqual([
        'u',
      ]);
      expect(names(await agent.get('/api/v1/applications?matchStatus=UNMATCHED'))).toEqual(['x']);
      expect(names(await agent.get('/api/v1/applications?matchStatus=UNSUPPORTED'))).toEqual(['s']);
      expect(names(await agent.get('/api/v1/applications?source=winget&sort=displayName'))).toEqual(
        ['m', 'u'],
      );
    });

    it('filters by one of the user’s devices', async () => {
      const { agent, userId } = await signUp();
      const d1 = await makeDevice(userId, { name: 'one' });
      const d2 = await makeDevice(userId, { name: 'two' });
      await makeApp(d1.id, { displayName: 'on-one' });
      await makeApp(d2.id, { displayName: 'on-two' });
      expect(names(await agent.get(`/api/v1/applications?deviceId=${d2.id}`))).toEqual(['on-two']);
    });

    it('hides removed applications unless asked', async () => {
      const { agent, userId } = await signUp();
      const device = await makeDevice(userId);
      await makeApp(device.id, { displayName: 'here' });
      await makeApp(device.id, { displayName: 'gone', removedAt: new Date() });

      expect(names(await agent.get('/api/v1/applications'))).toEqual(['here']);
      expect(names(await agent.get('/api/v1/applications?includeRemoved=false'))).toEqual(['here']);
      expect(
        names(await agent.get('/api/v1/applications?includeRemoved=true&sort=displayName')),
      ).toEqual(['gone', 'here']);
    });

    it('combines search, filter, sort and pagination correctly', async () => {
      const { agent, userId } = await signUp();
      await makeManyApps((await makeDevice(userId)).id, 30); // even numbers have updates: 15 apps

      const res = await agent.get(
        '/api/v1/applications?q=app&updateStatus=UPDATE_AVAILABLE&sort=displayName&order=desc&pageSize=5&page=2',
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ page: 2, pageSize: 5, total: 15, totalPages: 3 });
      expect(names(res)).toEqual(['app-20', 'app-18', 'app-16', 'app-14', 'app-12']);
    });

    it.each([
      ['page=0'],
      ['page=-1'],
      ['page=abc'],
      ['page=1.5'],
      ['pageSize=0'],
      ['pageSize=101'],
      ['sort=passwordHash'],
      ['sort=displayName;drop'],
      ['order=sideways'],
      ['updateStatus=BOGUS'],
      ['matchStatus=maybe'],
      ['deviceId=not-a-uuid'],
      ['includeRemoved=maybe'],
      [`q=${'x'.repeat(101)}`],
      ['q=a&q=b'],
    ])('rejects invalid query %s with a 400', async (query) => {
      const { agent } = await signUp();
      const res = await agent.get(`/api/v1/applications?${query}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.length).toBeGreaterThan(0);
    });

    it('does not expose internal columns', async () => {
      const { agent, userId } = await signUp();
      await makeApp((await makeDevice(userId)).id);
      const item = (await agent.get('/api/v1/applications')).body.data[0];
      expect(item).not.toHaveProperty('appKey');
      expect(item).not.toHaveProperty('createdAt');
      expect(item).not.toHaveProperty('updatedAt');
    });
  });

  describe('GET /applications/:id', () => {
    it('returns the application with release info and update history', async () => {
      const { agent, userId } = await signUp();
      const device = await makeDevice(userId);
      const pkg = `test.pkg.${randomUUID()}`;
      packageIds.push(pkg);
      const application = await makeApp(device.id, {
        displayName: 'Tool',
        packageId: pkg,
        installedVersion: '1.0',
        availableVersion: '2.0',
        matchStatus: 'MATCHED',
        updateStatus: 'UPDATE_AVAILABLE',
        source: 'winget',
      });
      await prisma.releaseMetadata.create({
        data: {
          packageId: pkg,
          version: '2.0',
          source: 'github',
          releaseDate: new Date('2026-10-01T00:00:00Z'),
          changelogUrl: 'https://example.com/changelog',
          officialUrl: 'https://example.com',
        },
      });
      // A release for a different version must not be picked.
      await prisma.releaseMetadata.create({
        data: { packageId: pkg, version: '1.5', source: 'github' },
      });
      for (const [i, state] of (['FAILED', 'SUCCEEDED'] as const).entries()) {
        await prisma.updateJob.create({
          data: {
            applicationId: application.id,
            deviceId: device.id,
            packageId: pkg,
            fromVersion: '0.9',
            targetVersion: '1.0',
            state,
            requestedAt: minutesAgo(60 - i * 10),
          },
        });
      }

      const res = await agent.get(`/api/v1/applications/${application.id}`);
      expect(res.status).toBe(200);
      expect(() => applicationDetailSchema.parse(res.body)).not.toThrow();
      expect(res.body).toMatchObject({
        id: application.id,
        displayName: 'Tool',
        isSample: false,
        release: {
          version: '2.0',
          changelogUrl: 'https://example.com/changelog',
          source: 'github',
        },
      });
      expect(res.body.updateHistory.map((j: { state: string }) => j.state)).toEqual([
        'SUCCEEDED',
        'FAILED',
      ]); // newest first
      expect(res.body.updateHistory[0].kind).toBe('update');
    });

    it('has no release when none is cached or the app is unmatched', async () => {
      const { agent, userId } = await signUp();
      const device = await makeDevice(userId);
      const unmatched = await makeApp(device.id, { matchStatus: 'UNMATCHED' });
      const res = await agent.get(`/api/v1/applications/${unmatched.id}`);
      expect(res.status).toBe(200);
      expect(res.body.release).toBeNull();
      expect(res.body.updateHistory).toEqual([]);
      expect(() => applicationDetailSchema.parse(res.body)).not.toThrow();
    });

    it('never passes on links that are not https', async () => {
      const { agent, userId } = await signUp();
      const device = await makeDevice(userId);
      const pkg = `test.pkg.${randomUUID()}`;
      packageIds.push(pkg);
      const application = await makeApp(device.id, { packageId: pkg, availableVersion: '2.0' });
      await prisma.releaseMetadata.create({
        data: {
          packageId: pkg,
          version: '2.0',
          source: 'feed',
          changelogUrl: 'javascript:alert(1)',
          officialUrl: 'http://example.com',
        },
      });

      const res = await agent.get(`/api/v1/applications/${application.id}`);
      expect(res.status).toBe(200);
      expect(res.body.release.changelogUrl).toBeNull();
      expect(res.body.release.officialUrl).toBeNull();
      expect(() => applicationDetailSchema.parse(res.body)).not.toThrow();
    });

    it('includes only this application’s update history', async () => {
      const { agent, userId } = await signUp();
      const device = await makeDevice(userId);
      const one = await makeApp(device.id, { displayName: 'one', packageId: 'p.one' });
      const two = await makeApp(device.id, { displayName: 'two', packageId: 'p.two' });
      await prisma.updateJob.create({
        data: {
          applicationId: two.id,
          deviceId: device.id,
          packageId: 'p.two',
          fromVersion: '1',
          targetVersion: '2',
        },
      });
      expect((await agent.get(`/api/v1/applications/${one.id}`)).body.updateHistory).toEqual([]);
      expect((await agent.get(`/api/v1/applications/${two.id}`)).body.updateHistory).toHaveLength(
        1,
      );
    });

    it('reports when the application belongs to a sample device', async () => {
      const { agent, userId } = await signUp();
      const device = await makeDevice(userId, { isSample: true });
      const application = await makeApp(device.id);
      expect((await agent.get(`/api/v1/applications/${application.id}`)).body.isSample).toBe(true);
    });

    it('hides other users’ applications behind a 404 identical to a missing one', async () => {
      const a = await signUp();
      const b = await signUp();
      const theirs = await makeApp((await makeDevice(b.userId)).id, { displayName: 'secret-app' });

      const foreign = await a.agent.get(`/api/v1/applications/${theirs.id}`);
      const missing = await a.agent.get(`/api/v1/applications/${randomUUID()}`);
      expect(foreign.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(foreign.body.error.code).toBe('NOT_FOUND');
      expect(foreign.body.error.message).toBe(missing.body.error.message);
      expect(JSON.stringify(foreign.body)).not.toContain('secret-app');
    });

    it('returns 404 for ids that are not UUIDs, including injection attempts', async () => {
      const { agent } = await signUp();
      for (const id of ['not-a-uuid', '1', encodeURIComponent(`1' OR '1'='1`), '..%2F..%2Fetc']) {
        expect((await agent.get(`/api/v1/applications/${id}`)).status).toBe(404);
      }
    });
  });
});
