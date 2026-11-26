import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

loadEnv({ path: '../../.env', quiet: true });
const hasDatabase = Boolean(process.env.DATABASE_URL && process.env.SESSION_SECRET);
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const PASSWORD = 'Correct-Horse-Battery-9';
const TEST_VERSION = '99.1.0-release-test';

/** A fake GitHub response, so the test never touches the network. */
const releaseFetch = vi.fn(
  async () =>
    new Response(
      JSON.stringify({
        tag_name: `v${TEST_VERSION}`,
        published_at: '2026-02-03T04:05:06Z',
        html_url: 'https://github.com/ip7z/7zip/releases/tag/test',
        prerelease: false,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
);

describe.skipIf(!hasDatabase)('release metadata route (database)', () => {
  let prisma: (typeof import('../lib/prisma'))['prisma'];
  let app: express.Express;
  const userIds: string[] = [];
  const deviceIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = await import('../lib/prisma'));
    const { createAuthRouter } = await import('../auth');
    const { applicationsRouter } = await import('./applications');
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
    // The network call is injected: this suite proves the wiring, not GitHub.
    app.use('/api/v1/applications', applicationsRouter({ releaseFetch }));
    app.use(notFound);
    app.use(errorHandler);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.releaseMetadata.deleteMany({
      where: { packageId: '7zip.7zip', version: TEST_VERSION },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  async function signedIn() {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: `rel-${randomUUID()}@example.test`, password: PASSWORD });
    userIds.push(res.body.user.id);
    const cookie = res.headers['set-cookie'] as unknown as string[];
    return { cookie, csrfToken: res.body.csrfToken as string, userId: res.body.user.id as string };
  }

  async function applicationFor(userId: string, packageId: string | null) {
    const device = await prisma.device.create({
      data: { ownerId: userId, name: 'REL-PC', status: 'ACTIVE' },
    });
    deviceIds.push(device.id);

    return prisma.application.create({
      data: {
        deviceId: device.id,
        appKey: `pkg:rel.${randomUUID()}`,
        displayName: 'Release Test App',
        installedVersion: '23.01',
        availableVersion: '24.08',
        packageId,
        source: packageId ? 'winget' : null,
        matchStatus: packageId ? 'MATCHED' : 'UNMATCHED',
        updateStatus: packageId ? 'UPDATE_AVAILABLE' : 'UNKNOWN',
      },
    });
  }

  const fetchRelease = (
    session: { cookie: string[]; csrfToken: string },
    id: string,
    csrf = true,
  ) => {
    const call = request(app)
      .post(`/api/v1/applications/${id}/release`)
      .set('Cookie', session.cookie);
    return csrf ? call.set('X-CSRF-Token', session.csrfToken) : call;
  };

  it('fetches release notes for a matched package and caches them', async () => {
    const session = await signedIn();
    const application = await applicationFor(session.userId, '7zip.7zip');

    const res = await fetchRelease(session, application.id);

    expect(res.status).toBe(200);
    expect(res.body.reason).toBe('ok');
    expect(res.body.release.version).toBe(TEST_VERSION);
    expect(res.body.release.changelogUrl).toContain('https://');
    expect(res.body.release.releaseDate).toBe('2026-02-03T04:05:06.000Z');

    // The fetched release is cached, which is what the next page load reads.
    const cached = await prisma.releaseMetadata.findFirst({
      where: { packageId: '7zip.7zip', version: TEST_VERSION },
    });
    expect(cached).not.toBeNull();
    expect(cached?.isSample).toBe(false);

    // The detail endpoint reports release information. It prefers the row for the version the user
    // could actually install, so the version here is not necessarily the one just fetched.
    const detail = await request(app)
      .get(`/api/v1/applications/${application.id}`)
      .set('Cookie', session.cookie);
    expect(detail.body.release).not.toBeNull();
    expect(detail.body.release.source).toBeTruthy();
  });

  it('refuses an application with no package identity', async () => {
    const session = await signedIn();
    const application = await applicationFor(session.userId, null);

    const res = await fetchRelease(session, application.id);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('UNSUPPORTED_PACKAGE');
  });

  it('answers plainly when the feed has nothing, without failing the request', async () => {
    const session = await signedIn();
    // A package with no known repository mapping.
    const application = await applicationFor(session.userId, 'Nobody.KnowsThis');

    const res = await fetchRelease(session, application.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ release: null, reason: 'NO_SOURCE' });
  });

  it('does not let another user fetch release notes for someone else’s application', async () => {
    const owner = await signedIn();
    const intruder = await signedIn();
    const application = await applicationFor(owner.userId, '7zip.7zip');

    expect((await fetchRelease(intruder, application.id)).status).toBe(404);
  });

  it('requires a session and a CSRF token', async () => {
    const session = await signedIn();
    const application = await applicationFor(session.userId, '7zip.7zip');

    expect((await request(app).post(`/api/v1/applications/${application.id}/release`)).status).toBe(
      401,
    );
    expect((await fetchRelease(session, application.id, false)).status).toBe(403);
  });
});
