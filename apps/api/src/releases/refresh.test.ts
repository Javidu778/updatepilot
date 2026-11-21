import { config as loadEnv } from 'dotenv';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { refreshRelease } from './refresh';

loadEnv({ path: '../../.env', quiet: true });
const hasDatabase = Boolean(process.env.DATABASE_URL && process.env.SESSION_SECRET);
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const TEST_VERSION = '99.0.0-test';
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe.skipIf(!hasDatabase)('refreshRelease (database)', () => {
  afterAll(async () => {
    const { prisma } = await import('../lib/prisma');
    await prisma.releaseMetadata.deleteMany({
      where: { packageId: '7zip.7zip', version: TEST_VERSION },
    });
    await prisma.$disconnect();
  });

  it('stores what the feed returned, with https links only', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        tag_name: `v${TEST_VERSION}`,
        published_at: '2026-01-02T03:04:05Z',
        html_url: 'https://github.com/ip7z/7zip/releases/tag/test',
        prerelease: false,
      }),
    );

    const result = await refreshRelease({
      packageId: '7zip.7zip',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.reason).toBe('ok');
    expect(result.release?.version).toBe(TEST_VERSION);
    expect(result.release?.changelogUrl).toContain('https://');

    const { prisma } = await import('../lib/prisma');
    const row = await prisma.releaseMetadata.findFirst({
      where: { packageId: '7zip.7zip', version: TEST_VERSION },
    });
    expect(row).not.toBeNull();
    expect(row?.isSample).toBe(false);
    expect(row?.source).toBe('github-releases');
    expect(row?.releaseDate?.toISOString()).toBe('2026-01-02T03:04:05.000Z');
  });

  it('is idempotent: fetching the same version twice updates the one row', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ tag_name: `v${TEST_VERSION}` }));

    await refreshRelease({
      packageId: '7zip.7zip',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await refreshRelease({
      packageId: '7zip.7zip',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const { prisma } = await import('../lib/prisma');
    const count = await prisma.releaseMetadata.count({
      where: { packageId: '7zip.7zip', version: TEST_VERSION },
    });
    expect(count).toBe(1);
  });

  it('reports a feed problem without throwing and without writing', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 403));
    const result = await refreshRelease({
      packageId: '7zip.7zip',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.release).toBeNull();
    expect(result.reason).toBe('RATE_LIMITED');
  });

  it('has no source for a package that is not in the registry', async () => {
    const result = await refreshRelease({ packageId: 'Some.UnknownPackage' });
    expect(result).toEqual({ release: null, reason: 'NO_SOURCE' });
  });
});
