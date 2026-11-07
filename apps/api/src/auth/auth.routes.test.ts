import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Integration tests: real HTTP requests against a real PostgreSQL database.
 *
 * They need DATABASE_URL and SESSION_SECRET (from the repo-root .env). Without them the whole
 * suite is skipped, so CI without a database still passes. Test users use @example.test
 * addresses and are deleted afterwards. No existing data is touched.
 */
loadEnv({ path: '../../.env', quiet: true });
const hasDatabase = Boolean(process.env.DATABASE_URL && process.env.SESSION_SECRET);

const PASSWORD = 'Correct-Horse-Battery-9';
const uniqueEmail = () => `test-${randomUUID()}@example.test`;

describe.skipIf(!hasDatabase)('auth routes (database)', () => {
  // Loaded after the skip check because importing the Prisma client requires DATABASE_URL.
  let prisma: (typeof import('../lib/prisma'))['prisma'];
  let app: express.Express;
  let strictApp: express.Express;
  let webOrigin: string;
  const startedAt = new Date();

  const buildApp = async (
    options: Parameters<(typeof import('./routes'))['createAuthRouter']>[0] = {},
  ) => {
    const { createAuthRouter } = await import('./routes');
    const { requireAuth, csrfProtection } = await import('./middleware');
    const { getOwnedDevice } = await import('./ownership');
    // The shell's own error handler, so the tests check the real error responses.
    const { errorHandler } = await import('../middleware/error-handler');

    const quietLog = { error: () => undefined, info: () => undefined };
    const instance = express();
    // The real app (app.ts) gets these from pino-http and a global body parser.
    instance.use((req, _res, next) => {
      Object.assign(req, { id: randomUUID(), log: quietLog });
      next();
    });
    instance.use(express.json({ limit: '1mb' }));
    instance.use('/api/v1/auth', createAuthRouter(options));
    // Stand-ins for real routes, to prove the helpers protect them.
    instance.get('/api/v1/devices/:id', requireAuth, async (req, res) => {
      const device = await getOwnedDevice(req.auth!.user.id, String(req.params.id));
      res.json({ id: device.id, name: device.name });
    });
    instance.post('/api/v1/devices/:id/scans', requireAuth, csrfProtection, (_req, res) => {
      res.status(202).json({ queued: true });
    });
    instance.use(errorHandler);
    return instance;
  };

  const register = (
    agent: ReturnType<typeof request.agent>,
    email = uniqueEmail(),
    password = PASSWORD,
  ) => agent.post('/api/v1/auth/register').send({ email, password });

  beforeAll(async () => {
    ({ prisma } = await import('../lib/prisma'));
    const { getAuthConfig } = await import('./config');
    webOrigin = getAuthConfig().webOrigin;
    // The main app has a high register limit so the many test sign-ups are not throttled.
    app = await buildApp({ registerLimit: 10_000 });
    // Tiny limits for the rate-limit tests only.
    strictApp = await buildApp({ loginEmailLimit: 3, loginIpLimit: 50, registerLimit: 2 });
  });

  afterAll(async () => {
    if (!prisma) return;
    const testUsers = await prisma.user.findMany({
      where: { email: { startsWith: 'test-', endsWith: '@example.test' } },
      select: { id: true },
    });
    const ids = testUsers.map((u) => u.id);
    // Remove the test users' audit events first, because deleting a user keeps them (actor set to null).
    await prisma.auditEvent.deleteMany({
      where: { OR: [{ actorUserId: { in: ids } }, { targetId: { in: ids } }] },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    // Failed logins for unknown emails have no user to match.
    await prisma.auditEvent.deleteMany({
      where: { targetType: 'login', actorUserId: null, createdAt: { gte: startedAt } },
    });
    await prisma.$disconnect();
  });

  describe('register', () => {
    it('creates an account, starts a session and never returns the password hash', async () => {
      const email = uniqueEmail();
      const res = await register(request.agent(app), email);

      expect(res.status).toBe(201);
      expect(res.body.user.email).toBe(email);
      expect(res.body.csrfToken).toEqual(expect.any(String));
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);

      const stored = await prisma.user.findUnique({ where: { email } });
      expect(stored?.passwordHash).toBeDefined();
      expect(stored?.passwordHash).not.toContain(PASSWORD);
    });

    it('sets a hardened session cookie', async () => {
      const res = await register(request.agent(app));
      const cookie = String(res.headers['set-cookie']);
      expect(cookie).toMatch(/up_session=/);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(/Path=\//);
    });

    it('stores only a hash of the session token', async () => {
      const agent = request.agent(app);
      const res = await register(agent);
      const token = /up_session=([^;]+)/.exec(String(res.headers['set-cookie']))![1]!;
      const sessions = await prisma.session.findMany({
        where: { user: { email: res.body.user.email } },
      });
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.tokenHash).not.toBe(token);
      expect(sessions[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('treats emails case-insensitively and rejects duplicates with a vague message', async () => {
      const email = uniqueEmail();
      await register(request.agent(app), email);
      const dup = await register(request.agent(app), email.toUpperCase());
      expect(dup.status).toBe(400);
      expect(dup.body.error.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(dup.body)).not.toMatch(/already|exists|taken|registered/i);
    });

    it('rejects a short password and an invalid email, naming the fields', async () => {
      const short = await register(request.agent(app), uniqueEmail(), 'short');
      expect(short.status).toBe(400);
      expect(short.body.error.details.map((d: { path: string }) => d.path)).toContain('password');

      const badEmail = await register(request.agent(app), 'not-an-email');
      expect(badEmail.status).toBe(400);
      expect(badEmail.body.error.details.map((d: { path: string }) => d.path)).toContain('email');
    });

    it('does not echo the submitted password in validation errors', async () => {
      const res = await register(request.agent(app), uniqueEmail(), 'tiny');
      expect(JSON.stringify(res.body)).not.toContain('tiny');
    });

    it('writes an audit event', async () => {
      const res = await register(request.agent(app));
      const events = await prisma.auditEvent.findMany({ where: { actorUserId: res.body.user.id } });
      expect(events.map((e) => e.eventType)).toContain('USER_REGISTERED');
    });

    it('rejects malformed JSON with the standard error format', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .set('Content-Type', 'application/json')
        .send('{"email": ');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.requestId).toEqual(expect.any(String));
    });

    it('rejects an oversized body', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: uniqueEmail(), password: 'x'.repeat(1_100_000) });
      expect(res.status).toBe(413);
    });

    it('rejects a very long password through validation (bcrypt limits are not an issue)', async () => {
      const res = await register(request.agent(app), uniqueEmail(), 'x'.repeat(5_000));
      expect(res.status).toBe(400);
      expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain('password');
    });
  });

  describe('login', () => {
    it('logs in with correct credentials', async () => {
      const email = uniqueEmail();
      await register(request.agent(app), email);

      const agent = request.agent(app);
      const res = await agent
        .post('/api/v1/auth/login')
        .send({ email: email.toUpperCase(), password: PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(email);
      expect(res.body.csrfToken).toEqual(expect.any(String));

      const me = await agent.get('/api/v1/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.user.email).toBe(email);
    });

    it('gives the same answer for a wrong password and an unknown email', async () => {
      const email = uniqueEmail();
      await register(request.agent(app), email);

      const wrongPassword = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'Wrong-Password-123' });
      const unknownEmail = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: uniqueEmail(), password: 'Wrong-Password-123' });

      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      expect(wrongPassword.body.error.code).toBe('UNAUTHENTICATED');
      expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
      expect(wrongPassword.headers['set-cookie']).toBeUndefined();
    });

    it('records failed attempts in the audit log without secrets', async () => {
      const email = uniqueEmail();
      const registered = await register(request.agent(app), email);
      await request(app).post('/api/v1/auth/login').send({ email, password: 'Wrong-Password-123' });

      const events = await prisma.auditEvent.findMany({
        where: { actorUserId: registered.body.user.id, eventType: 'UNAUTHORIZED_ATTEMPT' },
      });
      expect(events).toHaveLength(1);
      expect(JSON.stringify(events[0]!.metadata)).not.toMatch(/Wrong-Password|@example/);
    });

    it('replaces the old session when the same browser logs in again', async () => {
      const email = uniqueEmail();
      const agent = request.agent(app);
      const registered = await register(agent, email);
      await agent.post('/api/v1/auth/login').send({ email, password: PASSWORD });

      const count = await prisma.session.count({ where: { userId: registered.body.user.id } });
      expect(count).toBe(1);
    });

    it('rate limits repeated failures for one account', async () => {
      const email = uniqueEmail();
      await register(request.agent(strictApp), email);

      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        const res = await request(strictApp)
          .post('/api/v1/auth/login')
          .send({ email, password: 'Wrong-Password-123' });
        statuses.push(res.status);
        if (res.status === 429) expect(res.body.error.code).toBe('RATE_LIMITED');
      }
      expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
      expect(statuses.slice(3)).toEqual([429, 429]);
    });

    it('rate limits registrations from one IP', async () => {
      const limited = await buildApp({ registerLimit: 2 });
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) statuses.push((await register(request.agent(limited))).status);
      expect(statuses).toEqual([201, 201, 429, 429]);
    });

    it('does not lock out the real owner for successful logins', async () => {
      const email = uniqueEmail();
      await register(request.agent(strictApp), email);
      for (let i = 0; i < 6; i++) {
        const res = await request(strictApp)
          .post('/api/v1/auth/login')
          .send({ email, password: PASSWORD });
        expect(res.status).toBe(200);
      }
    });
  });

  describe('sessions and logout', () => {
    it('rejects requests with no cookie, a fake cookie or an expired session', async () => {
      expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
      expect(
        (await request(app).get('/api/v1/auth/me').set('Cookie', 'up_session=not-a-real-token'))
          .status,
      ).toBe(401);

      const agent = request.agent(app);
      const registered = await register(agent);
      await prisma.session.updateMany({
        where: { userId: registered.body.user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
    });

    it('logout needs the CSRF token, then ends the session', async () => {
      const agent = request.agent(app);
      const registered = await register(agent);

      const missing = await agent.post('/api/v1/auth/logout');
      expect(missing.status).toBe(403);
      expect(missing.body.error.code).toBe('FORBIDDEN');

      const wrong = await agent.post('/api/v1/auth/logout').set('X-CSRF-Token', 'wrong-token');
      expect(wrong.status).toBe(403);

      const ok = await agent
        .post('/api/v1/auth/logout')
        .set('X-CSRF-Token', registered.body.csrfToken);
      expect(ok.status).toBe(204);

      expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
      expect(await prisma.session.count({ where: { userId: registered.body.user.id } })).toBe(0);

      const events = await prisma.auditEvent.findMany({
        where: { actorUserId: registered.body.user.id },
      });
      expect(events.map((e) => e.eventType)).toContain('USER_LOGOUT');
    });

    it("a CSRF token from one session does not work for another user's session", async () => {
      const a = request.agent(app);
      const b = request.agent(app);
      const regA = await register(a);
      await register(b);

      const res = await b.post('/api/v1/auth/logout').set('X-CSRF-Token', regA.body.csrfToken);
      expect(res.status).toBe(403);
    });

    it('protects other state-changing routes with the same CSRF check', async () => {
      const agent = request.agent(app);
      const registered = await register(agent);
      const id = randomUUID();

      expect((await agent.post(`/api/v1/devices/${id}/scans`)).status).toBe(403);
      expect(
        (
          await agent
            .post(`/api/v1/devices/${id}/scans`)
            .set('X-CSRF-Token', registered.body.csrfToken)
        ).status,
      ).toBe(202);
    });
  });

  describe('origin check', () => {
    it('rejects a login that comes from another site', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('Origin', 'https://evil.example')
        .send({ email: uniqueEmail(), password: PASSWORD });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('accepts the real web origin', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .set('Origin', webOrigin)
        .send({ email: uniqueEmail(), password: PASSWORD });
      expect(res.status).toBe(201);
    });
  });

  describe('ownership', () => {
    it('lets the owner read a device and hides it from everyone else', async () => {
      const owner = request.agent(app);
      const other = request.agent(app);
      const regOwner = await register(owner);
      await register(other);

      const device = await prisma.device.create({
        data: { ownerId: regOwner.body.user.id, name: 'Owner PC' },
      });
      try {
        const mine = await owner.get(`/api/v1/devices/${device.id}`);
        expect(mine.status).toBe(200);
        expect(mine.body.name).toBe('Owner PC');

        const theirs = await other.get(`/api/v1/devices/${device.id}`);
        expect(theirs.status).toBe(404); // not 403, so IDs cannot be probed
        expect(theirs.body.error.code).toBe('NOT_FOUND');

        expect((await request(app).get(`/api/v1/devices/${device.id}`)).status).toBe(401);
      } finally {
        await prisma.device.delete({ where: { id: device.id } });
      }
    });

    it('returns 404 for IDs that are not UUIDs or do not exist', async () => {
      const agent = request.agent(app);
      await register(agent);
      expect((await agent.get('/api/v1/devices/not-a-uuid')).status).toBe(404);
      expect((await agent.get("/api/v1/devices/1'%20OR%20'1'='1")).status).toBe(404);
      expect((await agent.get(`/api/v1/devices/${randomUUID()}`)).status).toBe(404);
    });
  });
});
