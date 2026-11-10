import { errorResponseSchema } from '@updatepilot/shared';
import { API_URL } from './config';
import { ApiError, NetworkError, ResponseShapeError } from './errors';

/** Anything with a parse() method, such as a Zod schema from @updatepilot/shared. */
type Parser<T> = { parse: (data: unknown) => T };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type RequestOptions<T> = {
  body?: unknown;
  /** Validates the response. Without it the parsed JSON is returned as is. */
  schema?: Parser<T>;
  signal?: AbortSignal;
  /**
   * A 401 normally means "the session ended" and calls onUnauthenticated.
   * Set this to false where 401 is an expected answer: login, register and the first /auth/me.
   */
  handleUnauthenticated?: boolean;
};

export type ApiClientOptions = {
  baseUrl?: string;
  /** Defaults to the global fetch, looked up at call time so tests can replace it. */
  fetchImpl?: typeof fetch;
  /** The CSRF token of the current session, or null when signed out. */
  getCsrfToken: () => string | null;
  /** Called when a request that needed a session gets a 401. */
  onUnauthenticated?: () => void;
};

export type ApiClient = {
  request: <T = void>(method: string, path: string, options?: RequestOptions<T>) => Promise<T>;
  get: <T = void>(path: string, options?: RequestOptions<T>) => Promise<T>;
  post: <T = void>(path: string, options?: RequestOptions<T>) => Promise<T>;
};

function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

function toApiError(response: Response, json: unknown): ApiError {
  const retry = Number(response.headers.get('Retry-After'));
  const retryAfterSeconds = Number.isFinite(retry) && retry > 0 ? retry : undefined;

  const parsed = errorResponseSchema.safeParse(json);
  if (parsed.success) {
    const { code, message, details, requestId } = parsed.data.error;
    return new ApiError(
      response.status,
      code,
      message,
      details ?? [],
      requestId,
      retryAfterSeconds,
    );
  }
  const message =
    response.status >= 500
      ? 'The server had a problem.'
      : `The request failed (${response.status}).`;
  return new ApiError(response.status, 'UNKNOWN', message, [], undefined, retryAfterSeconds);
}

/**
 * The one place the web app talks to the API.
 *
 *  - Sends the session cookie (credentials: 'include').
 *  - Adds the X-CSRF-Token header to every state-changing request.
 *  - Turns the API's error format into ApiError, and unreachable servers into NetworkError.
 *  - Validates successful responses with the shared Zod schemas.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = (options.baseUrl ?? API_URL).replace(/\/+$/, '');

  async function request<T = void>(
    method: string,
    path: string,
    opts: RequestOptions<T> = {},
  ): Promise<T> {
    if (!path.startsWith('/')) throw new Error('API paths must start with "/"');

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (!SAFE_METHODS.has(method.toUpperCase())) {
      const token = options.getCsrfToken();
      if (token) headers['X-CSRF-Token'] = token;
    }

    let response: Response;
    try {
      const doFetch = options.fetchImpl ?? fetch;
      response = await doFetch(`${baseUrl}${path}`, {
        method,
        headers,
        credentials: 'include',
        cache: 'no-store',
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
      });
    } catch (error) {
      if (isAbort(error)) throw error; // the caller cancelled it, which is not a failure
      throw new NetworkError();
    }

    if (response.status === 204) return undefined as T;

    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }

    if (!response.ok) {
      if (response.status === 401 && opts.handleUnauthenticated !== false)
        options.onUnauthenticated?.();
      throw toApiError(response, json);
    }

    if (!opts.schema) return json as T;
    try {
      return opts.schema.parse(json);
    } catch {
      throw new ResponseShapeError();
    }
  }

  return {
    request,
    get: (path, opts) => request('GET', path, opts),
    post: (path, opts) => request('POST', path, opts),
  };
}
