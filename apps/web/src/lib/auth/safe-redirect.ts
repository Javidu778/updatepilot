const AUTH_PAGES = ['/login', '/register'];
const PLACEHOLDER_ORIGIN = 'http://placeholder.invalid';

/** Tabs, newlines and other control characters can hide a second address inside the value. */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Where to go after signing in, taken from the ?next= address parameter.
 *
 * That value comes from the address bar, so anyone can craft a link with it. Only a path on
 * this same site is accepted. Anything else (another site, //host, \host, a javascript: link,
 * control characters) falls back, so the login page cannot be used as an open redirect.
 * The sign-in pages themselves are refused too, to avoid a redirect loop.
 */
export function safeNextPath(value: string | null | undefined, fallback = '/'): string {
  if (!value || value.length > 2048) return fallback;
  if (hasControlCharacter(value)) return fallback;
  if (!value.startsWith('/')) return fallback;

  try {
    const url = new URL(value, PLACEHOLDER_ORIGIN);
    if (url.origin !== PLACEHOLDER_ORIGIN) return fallback;
    if (AUTH_PAGES.some((page) => url.pathname === page || url.pathname.startsWith(`${page}/`))) {
      return fallback;
    }
    const path = `${url.pathname}${url.search}${url.hash}`;
    // Dot segments such as /..//host can normalize into //host, which a browser treats as another site.
    if (path.startsWith('//')) return fallback;
    return path;
  } catch {
    return fallback;
  }
}
