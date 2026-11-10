# UpdatePilot: Web Sign-in and Session Handling

Status: Implemented in Week 2, Day 4
Code: `apps/web/src/lib/api/`, `apps/web/src/lib/auth/`, `apps/web/src/components/auth/`, `apps/web/src/app/(app)/` and `(auth)/`
API side: `docs/auth.md`

## 1. How it works

The browser talks to the API directly. Nothing on the Next.js server reads the session cookie, so every page stays statically prerendered, which is what Cache Components expects.

1. `AuthProvider` (root layout) asks `GET /api/v1/auth/me` once when the page loads.
2. The API answers with the user and a CSRF token, or `401`.
3. The CSRF token is kept in memory only. After a reload it is fetched again from `/auth/me`.
4. Every API call goes through one client (`useAuth().api`). It sends the session cookie, adds `X-CSRF-Token` to every state-changing request, validates the answer with the shared Zod schemas, and turns failures into `ApiError` or `NetworkError`.
5. `RequireAuth` (in the `(app)` layout) shows the app only to a signed-in user and sends everyone else to `/login?next=<page>`.

The guard decides what to **show**. The API refuses every request without a valid session, whatever the web app does.

## 2. Route groups

| Group    | URLs                                                                   | Layout                                        |
| -------- | ---------------------------------------------------------------------- | --------------------------------------------- |
| `(app)`  | `/`, `/applications`, `/updates`, `/security`, `/history`, `/settings` | Sidebar and top bar, wrapped in `RequireAuth` |
| `(auth)` | `/login`, `/register`                                                  | Clean layout, no navigation into the app      |

Route groups do not change URLs. New app pages go inside `(app)`.

## 3. Calling the API from a page

```tsx
'use client';
import { applicationsResponseSchema } from '@updatepilot/shared';
import { useAuth } from '@/lib/auth/session';

const { api } = useAuth();
const page = await api.get('/api/v1/applications?page=1&pageSize=25', {
  schema: applicationsResponseSchema,
});
```

- Paths must start with `/`. A full URL is refused, so the client can only talk to the configured API.
- A `401` on any call (the session ended) automatically sends the person to sign in with an explanation, and brings them back to the same page afterwards.
- Pass `signal` to cancel a request when a component unmounts. A cancelled request is not reported as an error.

## 4. Security measures

| Risk                           | Measure                                                                                                                                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open redirect through `?next=` | `safeNextPath` accepts only a path on this site. It rejects other sites, `//host`, `\host`, `javascript:` links, control characters, dot-segment tricks like `/..//host`, and the sign-in pages themselves |
| CSRF                           | The token is sent on every state-changing request and held only in memory                                                                                                                                  |
| Token theft from storage       | Nothing sensitive goes into localStorage, sessionStorage or a readable cookie. The session cookie is `HttpOnly`                                                                                            |
| Calling an unintended server   | The client builds every URL from the configured base and refuses paths that do not start with `/`                                                                                                          |
| Unsafe response data           | Every response is parsed with the shared schemas. A response that does not match is reported, not used                                                                                                     |
| Account enumeration            | One message for a wrong password and an unknown email. A registration for an existing email shows the API's vague message                                                                                  |
| Password left on screen        | A rejected password is cleared from the field. A show/hide button is available, off by default                                                                                                             |
| Double submission              | The button is disabled while a request is running                                                                                                                                                          |

## 5. Accessibility

Visible labels, `autocomplete` hints, errors linked to their field with `aria-describedby`, `aria-invalid` on bad fields, focus moved to the first problem after a failed submit, status messages announced (`role="status"` and `role="alert"`), and a skip link on every layout.

## 6. Configuration

| Variable              | Default                 | Meaning                                              |
| --------------------- | ----------------------- | ---------------------------------------------------- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | Where the API runs. Public, never put a secret in it |

Use `http://localhost:3000` in the browser, not `http://127.0.0.1:3000`. The API only accepts the exact origin set in `WEB_ORIGIN`.

## 7. Tests

`npm test -w apps/web` runs about 100 tests (Vitest and Testing Library, no browser needed): the API client (CSRF header, errors, 401 handling, Retry-After, cancelled requests), the redirect check, form validation, error messages, the session provider, the route guard, sign-out, and both forms (validation, focus, every error case, double submit, the `next` rules).

Passing tests only help if they fail when the code is wrong, so the security-relevant behaviors were checked by breaking them on purpose: removing the CSRF header, loosening the redirect check and leaving the password in the field each made tests fail.

The client was also run against the real API and database: registration, login, `/auth/me`, the devices, dashboard and applications endpoints, CSRF refusal, wrong passwords, rate limiting and an unreachable server.

## 8. Known limits

- A protected page shows "Checking your session…" for a moment before the app appears.
- A sign-out in one tab is noticed by other tabs on their next API call, not instantly.
- The "try again in N minutes" text needs the API to expose `Retry-After` to browsers (`exposedHeaders` in the CORS settings in `app.ts`). Without it the form shows a general "wait a few minutes" message.
- Sign-in cookies work across `localhost:3000` and `localhost:4000` because browsers treat them as the same site. A deployment needs the web app and API on the same registrable domain, for example `app.example.com` and `api.example.com`.
- No password reset, email verification or multi-factor sign-in yet.
