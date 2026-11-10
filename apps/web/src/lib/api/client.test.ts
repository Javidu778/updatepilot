// @vitest-environment node
import { authResponseSchema } from '@updatepilot/shared';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import { ApiError, NetworkError, ResponseShapeError, fieldMessages } from './errors';

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

function setup(
  response: Response | (() => Response | Promise<Response>),
  token: string | null = 'csrf-abc',
) {
  const fetchImpl = vi.fn(async () => (typeof response === 'function' ? response() : response));
  const onUnauthenticated = vi.fn();
  const api = createApiClient({
    baseUrl: 'http://api.test/',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    getCsrfToken: () => token,
    onUnauthenticated,
  });
  const lastCall = () => {
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    return { url, init, headers: new Headers(init.headers) };
  };
  return { api, fetchImpl, onUnauthenticated, lastCall };
}

describe('requests', () => {
  it('sends the session cookie and builds the URL from the base', async () => {
    const { api, lastCall } = setup(jsonResponse({ ok: true }));
    await api.get('/api/v1/health');
    expect(lastCall().url).toBe('http://api.test/api/v1/health');
    expect(lastCall().init.credentials).toBe('include');
    expect(lastCall().init.cache).toBe('no-store');
  });

  it('does not send a CSRF token on reads', async () => {
    const { api, lastCall } = setup(jsonResponse({}));
    await api.get('/api/v1/applications');
    expect(lastCall().headers.get('X-CSRF-Token')).toBeNull();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('sends the CSRF token on %s', async (method) => {
    const { api, lastCall } = setup(jsonResponse({}));
    await api.request(method, '/api/v1/anything');
    expect(lastCall().headers.get('X-CSRF-Token')).toBe('csrf-abc');
  });

  it('reads the token when the request is made, so a new session uses its own token', async () => {
    let token: string | null = 'first';
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}));
    const api = createApiClient({
      baseUrl: 'http://api.test',
      fetchImpl,
      getCsrfToken: () => token,
    });
    await api.post('/api/v1/x');
    token = 'second';
    await api.post('/api/v1/x');
    const tokens = fetchImpl.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get('X-CSRF-Token'),
    );
    expect(tokens).toEqual(['first', 'second']);
  });

  it('sends no token header when signed out', async () => {
    const { api, lastCall } = setup(jsonResponse({}), null);
    await api.post('/api/v1/auth/login', { body: { a: 1 } });
    expect(lastCall().headers.get('X-CSRF-Token')).toBeNull();
  });

  it('sends a JSON body with the right content type, and none when there is no body', async () => {
    const withBody = setup(jsonResponse({}));
    await withBody.api.post('/api/v1/x', { body: { email: 'a@b.co' } });
    expect(withBody.lastCall().headers.get('Content-Type')).toBe('application/json');
    expect(withBody.lastCall().init.body).toBe('{"email":"a@b.co"}');

    const withoutBody = setup(jsonResponse({}));
    await withoutBody.api.post('/api/v1/x');
    expect(withoutBody.lastCall().headers.get('Content-Type')).toBeNull();
    expect(withoutBody.lastCall().init.body).toBeUndefined();
  });

  it('refuses a path that does not start with a slash, so a full URL cannot be passed in', async () => {
    const { api, fetchImpl } = setup(jsonResponse({}));
    await expect(api.get('https://evil.example/steal')).rejects.toThrow(/must start with/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('responses', () => {
  const auth = {
    user: {
      id: '3f2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6b',
      email: 'a@b.co',
      createdAt: '2026-11-01T10:00:00.000Z',
    },
    csrfToken: 'tok',
  };

  it('returns validated data', async () => {
    const { api } = setup(jsonResponse(auth));
    await expect(api.get('/api/v1/auth/me', { schema: authResponseSchema })).resolves.toEqual(auth);
  });

  it('rejects a response that does not match the shared contract', async () => {
    const { api } = setup(jsonResponse({ user: { email: 'a@b.co' } }));
    await expect(api.get('/api/v1/auth/me', { schema: authResponseSchema })).rejects.toBeInstanceOf(
      ResponseShapeError,
    );
  });

  it('returns undefined for 204 No Content', async () => {
    const { api } = setup(new Response(null, { status: 204 }));
    await expect(api.post('/api/v1/auth/logout')).resolves.toBeUndefined();
  });

  it('turns the API error format into an ApiError', async () => {
    const body = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The request is not valid',
        requestId: 'req-9',
        details: [{ path: 'email', message: 'Invalid email' }],
      },
    };
    const { api } = setup(jsonResponse(body, { status: 400 }));
    const error = await api.post('/api/v1/auth/register', { body: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', requestId: 'req-9' });
    expect(fieldMessages(apiError)).toEqual({ email: 'Invalid email' });
  });

  it('copes with an error body that is not in the API format (proxy page, empty body)', async () => {
    const html = setup(new Response('<html>Bad gateway</html>', { status: 502 }));
    const error = (await html.api.get('/api/v1/x').catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 502,
      code: 'UNKNOWN',
      message: 'The server had a problem.',
    });

    const empty = setup(new Response(null, { status: 404 }));
    const notFound = (await empty.api.get('/api/v1/x').catch((e: unknown) => e)) as ApiError;
    expect(notFound.message).toBe('The request failed (404).');
  });

  it('reads Retry-After from rate limit answers', async () => {
    const { api } = setup(
      jsonResponse(
        { error: { code: 'RATE_LIMITED', message: 'Slow down', requestId: 'r' } },
        { status: 429, headers: { 'Retry-After': '120' } },
      ),
    );
    const error = (await api.get('/api/v1/x').catch((e: unknown) => e)) as ApiError;
    expect(error.retryAfterSeconds).toBe(120);
  });

  it('ignores a Retry-After it cannot read', async () => {
    const { api } = setup(
      jsonResponse(
        { error: { code: 'RATE_LIMITED', message: 'Slow down', requestId: 'r' } },
        { status: 429, headers: { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' } },
      ),
    );
    const error = (await api.get('/api/v1/x').catch((e: unknown) => e)) as ApiError;
    expect(error.retryAfterSeconds).toBeUndefined();
  });
});

describe('401 handling', () => {
  const unauthorized = () =>
    jsonResponse(
      { error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: 'r' } },
      { status: 401 },
    );

  it('tells the session about a 401 on a normal request', async () => {
    const { api, onUnauthenticated } = setup(unauthorized);
    await expect(api.get('/api/v1/applications')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });

  it('does not, where a 401 is an expected answer (login, first session check)', async () => {
    const { api, onUnauthenticated } = setup(unauthorized);
    await expect(
      api.post('/api/v1/auth/login', { body: {}, handleUnauthenticated: false }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it('does not treat other errors as a lost session', async () => {
    const { api, onUnauthenticated } = setup(() =>
      jsonResponse(
        { error: { code: 'FORBIDDEN', message: 'No', requestId: 'r' } },
        { status: 403 },
      ),
    );
    await expect(api.post('/api/v1/x')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });
});

describe('network failures', () => {
  it('turns an unreachable server into a NetworkError', async () => {
    const { api } = setup(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(api.get('/api/v1/health')).rejects.toBeInstanceOf(NetworkError);
  });

  it('passes a cancelled request through unchanged, so callers can ignore it', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const { api } = setup(() => {
      throw abort;
    });
    await expect(api.get('/api/v1/health')).rejects.toBe(abort);
  });
});
