import type { NextRequest } from 'next/server';

/**
 * Same-origin proxy to the API.
 *
 * The session cookie is `SameSite=Lax`, so a browser on `app.example.com` will not send a cookie set by
 * `api.example.com` unless both share a registrable domain. Rather than requiring a domain, this route
 * makes the browser talk only to this origin: `/api/v1/...` is forwarded to the API and the response
 * (including `Set-Cookie`) is passed straight back.
 *
 * A Route Handler rather than an external `rewrite` on purpose: forwarding `Set-Cookie` is the entire
 * point, and doing it explicitly means it is testable and not dependent on a host's rewrite semantics.
 *
 * Configured with `UPDATEPILOT_API_PROXY`. When it is unset, the route answers 503 instead of pretending
 * to work, and `NEXT_PUBLIC_API_URL` should point at the API directly instead.
 */
const TARGET = process.env.UPDATEPILOT_API_PROXY?.trim().replace(/\/+$/, '');

// Hop-by-hop headers and anything the fetch layer already computed.
const STRIP_RESPONSE = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'transfer-encoding',
]);

// The client's Host is this domain; the API needs its own.
const STRIP_REQUEST = new Set(['host', 'connection', 'content-length']);

async function forward(request: NextRequest, path: string[]): Promise<Response> {
  if (!TARGET) {
    return Response.json(
      {
        error: {
          code: 'PROXY_NOT_CONFIGURED',
          message: 'The API proxy is not configured on this deployment.',
        },
      },
      { status: 503 },
    );
  }

  const search = new URL(request.url).search;
  const target = `${TARGET}/api/${path.map(encodeURIComponent).join('/')}${search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!STRIP_REQUEST.has(key.toLowerCase())) headers.set(key, value);
  });

  const method = request.method.toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(target, { method, headers, body, redirect: 'manual' });
  } catch {
    return Response.json(
      {
        error: {
          code: 'API_UNREACHABLE',
          message: 'The API could not be reached from this server.',
        },
      },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (STRIP_RESPONSE.has(lower) || lower === 'set-cookie') return;
    responseHeaders.set(key, value);
  });

  // A session response can carry more than one cookie, so they are appended, never collapsed.
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append('set-cookie', cookie);
  }

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

type Context = { params: Promise<{ path?: string[] }> };

async function handler(request: NextRequest, context: Context): Promise<Response> {
  const { path } = await context.params;
  return forward(request, path ?? []);
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
