# UpdatePilot: Authentication and Session Security

Status: Implemented in Week 2, Day 2
Code: `apps/api/src/auth/`, `apps/api/src/http/`
Decisions: D-07 (web authentication) in `docs/decisions.md`

## 1. Summary

Web users sign in with email and password. A successful login creates a **server-side session**. The browser holds only a random token in an `httpOnly` cookie. The database stores only a SHA-256 hash of that token, so a database leak does not leak usable sessions, and logout really ends the session (a stateless JWT cannot do that).

Agents do **not** use this system. They use their own credential (Week 3).

## 2. Endpoints

| Method | Path                    | Auth                 | Purpose                                     |
| ------ | ----------------------- | -------------------- | ------------------------------------------- |
| POST   | `/api/v1/auth/register` | none                 | Create an account and start a session (201) |
| POST   | `/api/v1/auth/login`    | none                 | Start a session (200)                       |
| POST   | `/api/v1/auth/logout`   | session + CSRF token | End the session (204)                       |
| GET    | `/api/v1/auth/me`       | session              | Current user and a fresh CSRF token         |

`register`, `login` and `me` return `{ user, csrfToken }` (type `AuthResponse` in `@updatepilot/shared`).

## 3. How the web app must call the API

1. Every request uses `credentials: 'include'` so the cookie is sent.
2. Keep the `csrfToken` from login, register or `/auth/me` in memory (not in localStorage).
3. Send it as the `X-CSRF-Token` header on every POST, PUT, PATCH and DELETE.
4. On page load call `GET /auth/me`. A `401` means "not signed in", and the app redirects to the login page.

```ts
await fetch(`${API_URL}/api/v1/devices/${id}/scans`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'X-CSRF-Token': csrfToken },
});
```

The API must allow the web origin with credentials (CORS). If the web app and API run on different ports in development, use `cors({ origin: WEB_ORIGIN, credentials: true })`, with the exact origin and never `*`.

## 3a. Mounting in `app.ts`

```ts
app.use(express.json({ limit: '1mb' })); // global body parser comes first
app.use('/api/v1/auth', createAuthRouter()); // reads req.body, so it must come after the parser
// ... other routers ...
app.use(notFound);
app.use(errorHandler); // the shell's handler from ./middleware/error-handler
```

The auth router relies on the shell for: the body parser, request IDs and logging (pino-http), CORS (the `X-CSRF-Token` header is already allowed), the error handler and the rate limiter factory `createRateLimiter` (extended with two optional settings: `skipSuccessfulRequests` and `key`).

## 4. Protecting a route

```ts
import { requireAuth, csrfProtection, getOwnedDevice } from './auth';

// Read route (Express 5 forwards errors from async handlers automatically)
router.get('/devices/:id', requireAuth, async (req, res) => {
  const device = await getOwnedDevice(req.auth!.user.id, String(req.params.id));
  res.json(device);
});

// State-changing route: also needs the CSRF check
router.post('/devices/:id/scans', requireAuth, csrfProtection, async (req, res) => {
  /* ... */
});
```

Rules for every new route:

- Use `requireAuth` on everything except register, login and the agent routes.
- Add `csrfProtection` after `requireAuth` on every state-changing route.
- **Never** load a device or application with a bare `findUnique({ where: { id } })`. Always go through `getOwnedDevice` or `getOwnedApplication`. A resource that is missing and one that belongs to someone else both return `404`, so IDs cannot be probed.
- Validate requests with the shell's `validate({ body, query, params })` and the shared Zod schemas, then read the result with `getValidated`.
- Throw the shell's `AppError` (`apps/api/src/lib/errors.ts`). The shell's error handler (`middleware/error-handler.ts`) is the only place that writes error responses. `auth/errors.ts` has small helpers: `unauthenticated()`, `forbidden()`, `notFound()`.
- Do not add a second error handler or a second request-ID middleware. Request IDs come from pino-http in `app.ts`.

## 5. Security measures

| Threat                        | Measure                                                                                                                                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stolen database               | Passwords stored as bcrypt hashes; session tokens stored only as SHA-256 hashes                                                                                                                                               |
| Weak password storage         | bcrypt cost 12 (cost 4 in tests only). The password is first reduced with SHA-256 so bcrypt's 72-byte limit cannot silently cut long passwords                                                                                |
| Session theft by XSS          | Cookie is `HttpOnly`; CSRF token held in memory, not storage                                                                                                                                                                  |
| Session theft on the network  | Cookie is `Secure` in production (HTTPS only)                                                                                                                                                                                 |
| CSRF                          | `SameSite=Lax` cookie, a per-session CSRF token (HMAC of the session hash) checked on every state-changing request, plus an `Origin` header check                                                                             |
| Session fixation              | A new session token is issued on every login and the browser's old session is deleted                                                                                                                                         |
| Account enumeration           | Login gives the same message for a wrong password and an unknown email, and does the same amount of hashing work (a dummy hash is checked when the email is unknown). Registration of an existing email gives a vague message |
| Brute force                   | Login: 5 failed attempts per email and 20 per IP per 15 minutes. Registration: 10 per IP per hour. Successful logins are not counted, so the real owner is not locked out                                                     |
| Oversized or malformed bodies | The app's global 1 MB JSON limit, then strict field limits from the shared schemas (password at most 128 characters, email at most 254); malformed JSON returns the standard error                                            |
| ID probing                    | Ownership helpers return `404` for other users' resources and for IDs that are not UUIDs                                                                                                                                      |
| Information leaks             | Error responses never include stack traces; validation errors contain field paths and messages, never the submitted values; audit metadata never holds secrets or emails                                                      |
| Forgotten audit trail         | Registration, login, failed login (without the attempted email), and logout are written to `AuditEvent`                                                                                                                       |

## 6. Configuration

| Variable         | Required                             | Meaning                                                                                                |
| ---------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `SESSION_SECRET` | Yes                                  | At least 32 random characters. Key for CSRF tokens. Keep it private and different in every environment |
| `WEB_ORIGIN`     | No (default `http://localhost:3000`) | Exact origin of the web app, used for the Origin check and CORS                                        |
| `NODE_ENV`       | No                                   | `production` turns on `Secure` cookies and requires the Origin header                                  |

Generate a secret:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Put the generated value in your local `.env`. In `.env.example` keep only a placeholder, because that file is public.

The server refuses to start the auth router if `SESSION_SECRET` is missing or too short.

## 7. Database changes

One new table and one new enum value (applied by `scripts/apply-auth-patch.mjs`):

- `Session` (id, userId, tokenHash unique, createdAt, expiresAt, lastUsedAt), deleted automatically when the user is deleted.
- `USER_LOGOUT` in the `AuditEventType` enum (in the schema and in `packages/shared/src/enums.ts`).

If the patch script reports `NOT FOUND` for the schema, add by hand:

1. In `enum AuditEventType`, a new line `USER_LOGOUT` after `USER_LOGIN`.
2. In `model User`, the line `sessions     Session[]`.
3. This model, placed before `model Device`:

```prisma
model Session {
  id         String   @id @default(uuid()) @db.Uuid
  userId     String   @db.Uuid
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String   @unique
  createdAt  DateTime @default(now())
  expiresAt  DateTime
  lastUsedAt DateTime @default(now())

  @@index([userId])
  @@index([expiresAt])
}
```

Session lifetime is 7 days. `lastUsedAt` is refreshed at most once per minute. Expired sessions are rejected immediately and cleaned up at the next login.

## 8. Tests

| Command                | What runs                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm test -w apps/api` | Unit tests (password hashing, tokens, CSRF tokens) and, when a database is configured, integration tests |

The integration tests make real HTTP requests against the real database. They cover registration, login, wrong credentials, the same-answer rule for unknown emails, hardened cookie flags, hashed session storage, logout with and without the CSRF token, a CSRF token from another session, cross-site Origin rejection, expired sessions, rate limiting of both logins and registrations, malformed, oversized and over-long inputs, and ownership (owner allowed, another user and anonymous refused, invalid IDs and injection strings give 404).

They use `@example.test` addresses and remove every row they create (users, sessions, audit events), so they are safe to run against your development database. Without `DATABASE_URL` and `SESSION_SECRET` the integration tests are skipped, so CI without a database stays green. Week 2 Day 6 adds a Postgres service to CI so they run there too.

## 9. Known limits (planned or accepted for the MVP)

- Rate limiting is in memory. It resets on restart and is not shared between processes. A multi-instance deployment needs a shared store such as Redis.
- No email verification, password reset, or multi-factor authentication.
- No limit on the number of concurrent sessions per user, and no "sign out everywhere" button yet.
- No check against lists of breached or common passwords (length of at least 12 is enforced).
- Local development runs over plain HTTP on localhost. A real deployment must use HTTPS and can then use a `__Host-` cookie name prefix.
- Production behind a reverse proxy needs `app.set('trust proxy', ...)` so rate limits see real client IPs.
