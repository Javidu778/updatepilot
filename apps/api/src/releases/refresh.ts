import { prisma } from '../lib/prisma';
import { fetchLatestRelease } from './github';
import { repoForPackageId } from './registry';

/** Where the cached rows came from. Kept in one place so the queries can filter on it. */
export const RELEASE_SOURCE = 'github-releases';
export const RELEASE_CHANNEL = 'stable';

export type CachedRelease = {
  version: string;
  releaseDate: string | null;
  changelogUrl: string | null;
  officialUrl: string | null;
  source: string;
  fetchedAt: string;
};

export type RefreshResult = {
  release: CachedRelease | null;
  /** "ok" or why there is nothing to show. The UI turns this into a plain sentence. */
  reason: 'ok' | 'NO_SOURCE' | 'NOT_FOUND' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'BAD_RESPONSE';
};

/**
 * Fetches the latest release for a package and stores it in the cache.
 *
 * Never throws for a feed problem: the caller gets `release: null` and a reason. That matters
 * because this runs while somebody is waiting for a page, and a third-party outage must read as
 * "Not available", not as a 500.
 */
export async function refreshRelease(args: {
  packageId: string | null;
  fetchImpl?: typeof fetch;
  token?: string;
  now?: Date;
}): Promise<RefreshResult> {
  const repo = repoForPackageId(args.packageId);
  if (!repo || !args.packageId) return { release: null, reason: 'NO_SOURCE' };

  const result = await fetchLatestRelease({
    ...repo,
    ...(args.fetchImpl ? { fetchImpl: args.fetchImpl } : {}),
    ...(args.token ? { token: args.token } : {}),
  });
  if (!result.ok) return { release: null, reason: result.reason };

  const now = args.now ?? new Date();
  const releaseDate = result.release.releaseDate ? new Date(result.release.releaseDate) : null;

  const row = await prisma.releaseMetadata.upsert({
    where: {
      packageId_version_channel_source: {
        packageId: args.packageId,
        version: result.release.version,
        channel: RELEASE_CHANNEL,
        source: RELEASE_SOURCE,
      },
    },
    create: {
      packageId: args.packageId,
      version: result.release.version,
      channel: RELEASE_CHANNEL,
      releaseDate,
      changelogUrl: result.release.changelogUrl,
      officialUrl: result.release.officialUrl,
      source: RELEASE_SOURCE,
      fetchedAt: now,
      isSample: false,
    },
    // Re-fetching the same version only refreshes the timestamps and links.
    update: {
      releaseDate,
      changelogUrl: result.release.changelogUrl,
      officialUrl: result.release.officialUrl,
      fetchedAt: now,
      isSample: false,
    },
  });

  return {
    release: {
      version: row.version,
      releaseDate: row.releaseDate ? row.releaseDate.toISOString() : null,
      changelogUrl: row.changelogUrl,
      officialUrl: row.officialUrl,
      source: row.source,
      fetchedAt: row.fetchedAt.toISOString(),
    },
    reason: 'ok',
  };
}

/** Convention for a feed older than this: worth fetching again. */
export const RELEASE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** True when a cached release is missing or older than the convention above. */
export function isStale(fetchedAt: Date | null, now: Date = new Date()): boolean {
  if (!fetchedAt) return true;
  return now.getTime() - fetchedAt.getTime() > RELEASE_CACHE_MAX_AGE_MS;
}
