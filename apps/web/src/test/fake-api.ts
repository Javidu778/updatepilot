import { vi } from 'vitest';

type Reply =
  { status?: number; json?: unknown; headers?: Record<string, string> } | 'network-error';
type Handler = Reply | ((request: { body: unknown; headers: Headers }) => Reply | Promise<Reply>);

export type RecordedCall = {
  method: string;
  path: string;
  body: unknown;
  headers: Headers;
  credentials: RequestCredentials | undefined;
};

/**
 * A stand-in for the API, for tests. Routes are keyed by "METHOD /path".
 * A route may be a single reply or a list of replies used one after another (the last repeats).
 */
export function createFakeApi(routes: Record<string, Handler | Handler[]>) {
  const calls: RecordedCall[] = [];
  const counters = new Map<string, number>();

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const key = `${method} ${url.pathname}`;
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, path: url.pathname, body, headers, credentials: init?.credentials });

    const entry = routes[key];
    if (!entry) throw new Error(`Unexpected API call: ${key}`);
    const index = counters.get(key) ?? 0;
    counters.set(key, index + 1);
    const handler = Array.isArray(entry)
      ? (entry[Math.min(index, entry.length - 1)] as Handler)
      : entry;
    const reply = typeof handler === 'function' ? await handler({ body, headers }) : handler;

    if (reply === 'network-error') throw new TypeError('Failed to fetch');
    const status = reply.status ?? 200;
    if (status === 204) return new Response(null, { status });
    return new Response(JSON.stringify(reply.json ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json', ...reply.headers },
    });
  });

  return {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    calls,
    callsTo: (key: string) => calls.filter((call) => `${call.method} ${call.path}` === key),
  };
}

export const demoUser = {
  id: '3f2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6b',
  email: 'demo@updatepilot.local',
  createdAt: '2026-11-01T10:00:00.000Z',
};

export const authBody = (csrfToken = 'csrf-token-1') => ({ user: demoUser, csrfToken });

export const apiError = (status: number, code: string, message: string, details?: unknown[]) => ({
  status,
  json: { error: { code, message, requestId: 'req-1', ...(details ? { details } : {}) } },
});
