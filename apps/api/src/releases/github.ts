/**
 * Release metadata from the public GitHub Releases API.
 *
 * This module never throws: a feed that is down, rate limited or returning nonsense must not break
 * a page or a scan. Every failure comes back as a reason the caller can log and show.
 *
 * Only https links are passed on. A release body is never rendered as HTML anywhere in the UI.
 */

export type GithubRelease = {
  /** Tag with any leading "v" removed: "v7.23.0" becomes "7.23.0". */
  version: string;
  releaseDate: string | null;
  changelogUrl: string | null;
  officialUrl: string | null;
  isPreRelease: boolean;
};

export type ReleaseFetchResult =
  | { ok: true; release: GithubRelease }
  | {
      ok: false;
      reason: 'NO_SOURCE' | 'NOT_FOUND' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'BAD_RESPONSE';
    };

const TIMEOUT_MS = 5000;

function httpsOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Turns one GitHub release payload into what the database stores. Exported for testing. */
export function parseGithubRelease(json: unknown): GithubRelease | null {
  if (typeof json !== 'object' || json === null) return null;
  const payload = json as Record<string, unknown>;

  const tag = typeof payload.tag_name === 'string' ? payload.tag_name.trim() : '';
  const version = tag.replace(/^v/i, '');
  if (!/^\d[\w.+-]{0,63}$/.test(version)) return null;

  const pageUrl = httpsOrNull(payload.html_url);

  return {
    version,
    releaseDate: isoOrNull(payload.published_at ?? payload.created_at),
    changelogUrl: pageUrl,
    officialUrl: pageUrl,
    isPreRelease: payload.prerelease === true,
  };
}

/**
 * Fetches the latest release of one repository.
 *
 * `fetchImpl` exists so the tests never touch the network. A `token` is optional; without it GitHub
 * allows 60 requests an hour per address, and a 403/429 is reported as RATE_LIMITED and cached by
 * the caller exactly like a success, so the API is not hammered.
 */
export async function fetchLatestRelease(args: {
  owner: string;
  repo: string;
  fetchImpl?: typeof fetch;
  token?: string;
  timeoutMs?: number;
}): Promise<ReleaseFetchResult> {
  const doFetch = args.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? TIMEOUT_MS);

  try {
    const response = await doFetch(
      `https://api.github.com/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'UpdatePilot',
          ...(args.token ? { Authorization: `Bearer ${args.token}` } : {}),
        },
        signal: controller.signal,
      },
    );

    if (response.status === 404) return { ok: false, reason: 'NOT_FOUND' };
    if (response.status === 403 || response.status === 429) {
      return { ok: false, reason: 'RATE_LIMITED' };
    }
    if (!response.ok) return { ok: false, reason: 'UNAVAILABLE' };

    const release = parseGithubRelease(await response.json().catch(() => null));
    return release ? { ok: true, release } : { ok: false, reason: 'BAD_RESPONSE' };
  } catch {
    // Offline, DNS failure, timeout, TLS problem: all the same to the caller.
    return { ok: false, reason: 'UNAVAILABLE' };
  } finally {
    clearTimeout(timer);
  }
}
