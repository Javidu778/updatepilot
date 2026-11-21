import { describe, expect, it, vi } from 'vitest';
import { fetchLatestRelease, parseGithubRelease } from './github';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('parseGithubRelease', () => {
  it('reads a real release payload', () => {
    expect(
      parseGithubRelease({
        tag_name: 'v24.08',
        published_at: '2024-08-01T10:00:00Z',
        html_url: 'https://github.com/ip7z/7zip/releases/tag/24.08',
        prerelease: false,
      }),
    ).toEqual({
      version: '24.08',
      releaseDate: '2024-08-01T10:00:00.000Z',
      changelogUrl: 'https://github.com/ip7z/7zip/releases/tag/24.08',
      officialUrl: 'https://github.com/ip7z/7zip/releases/tag/24.08',
      isPreRelease: false,
    });
  });

  it('strips a leading v from the tag', () => {
    expect(parseGithubRelease({ tag_name: 'v2.56.1' })?.version).toBe('2.56.1');
  });

  it('drops a link that is not https', () => {
    expect(
      parseGithubRelease({ tag_name: '1.0', html_url: 'http://example.com/x' })?.changelogUrl,
    ).toBeNull();
    expect(
      parseGithubRelease({ tag_name: '1.0', html_url: 'javascript:alert(1)' })?.officialUrl,
    ).toBeNull();
  });

  it('refuses a tag that is not a version', () => {
    expect(parseGithubRelease({ tag_name: 'nightly' })).toBeNull();
    expect(parseGithubRelease({ tag_name: '' })).toBeNull();
  });

  it('refuses a payload that is not an object', () => {
    expect(parseGithubRelease(null)).toBeNull();
    expect(parseGithubRelease('nope')).toBeNull();
    expect(parseGithubRelease([1, 2])).toBeNull();
  });

  it('treats a missing date as unknown, not as today', () => {
    expect(parseGithubRelease({ tag_name: '1.0' })?.releaseDate).toBeNull();
    expect(
      parseGithubRelease({ tag_name: '1.0', published_at: 'not-a-date' })?.releaseDate,
    ).toBeNull();
  });
});

describe('fetchLatestRelease', () => {
  const args = { owner: 'ip7z', repo: '7zip' };

  it('returns the release on 200', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ tag_name: 'v24.08' }));
    const result = await fetchLatestRelease({
      ...args,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.release.version).toBe('24.08');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('requests the documented endpoint and sends a User-Agent, which GitHub requires', async () => {
    let requestedUrl = '';
    let seenHeaders: Record<string, string> = {};
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      requestedUrl = url;
      seenHeaders = (init?.headers ?? {}) as Record<string, string>;
      return jsonResponse({ tag_name: '1.0' });
    });

    await fetchLatestRelease({ ...args, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(requestedUrl).toBe('https://api.github.com/repos/ip7z/7zip/releases/latest');
    expect(seenHeaders['User-Agent']).toBe('UpdatePilot');
    expect(seenHeaders.Accept).toContain('github');
  });

  it('reports a missing repository', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 404));
    expect(
      await fetchLatestRelease({ ...args, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
  });

  it('reports rate limiting, which happens without a token', async () => {
    for (const status of [403, 429]) {
      const fetchImpl = vi.fn(async () => jsonResponse({}, status));
      expect(
        await fetchLatestRelease({ ...args, fetchImpl: fetchImpl as unknown as typeof fetch }),
      ).toEqual({
        ok: false,
        reason: 'RATE_LIMITED',
      });
    }
  });

  it('reports an outage', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500));
    expect(
      await fetchLatestRelease({ ...args, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).toEqual({
      ok: false,
      reason: 'UNAVAILABLE',
    });
  });

  it('reports a network failure instead of throwing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(
      await fetchLatestRelease({ ...args, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).toEqual({
      ok: false,
      reason: 'UNAVAILABLE',
    });
  });

  it('reports a body it cannot read', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('not json', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    expect(
      await fetchLatestRelease({ ...args, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).toEqual({
      ok: false,
      reason: 'BAD_RESPONSE',
    });
  });
});
