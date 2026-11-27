# UpdatePilot: Deployment

Status: this document describes how the finished parts are hosted. It is not a claim that a production
deployment exists today.
Related: [`docs/agent.md`](agent.md), [`docs/auth.md`](auth.md), [`docs/threat-model.md`](threat-model.md)

## 1. Four pieces, three of them servers

| Piece                                  | Where it must run                                     | Why                                                                 |
| -------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| **Web** (`apps/web`, Next.js)          | Vercel, or any Node host                              | Static/SSR pages that call the API from the browser                 |
| **API** (`apps/api`, Express + Prisma) | A long-running container: Render, Railway, Fly, a VPS | See §2                                                              |
| **Database** (PostgreSQL)              | Neon, Supabase, Render Postgres, or self-hosted       | Prisma needs a normal Postgres URL                                  |
| **Agent** (`apps/agent`)               | **Each Windows PC that should be managed**            | It reads WinGet and runs installers locally. The browser never does |

The important consequence: the web app can be on Vercel, but **the agent is installed per machine**. That is
what makes "another PC" work — see §7.

## 2. Why the API does not belong on Vercel

Vercel runs functions, not a server process, and this API needs four things functions make awkward:

| Need                             | Why it breaks on functions                                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| A lasting Postgres connection    | Every invocation would open new connections. You need Prisma Accelerate or PgBouncer, or you exhaust the database                |
| In-memory rate limiting          | Each instance has its own counters, so a limit of 20 becomes 20 per instance. `docs/auth.md` already lists this as a known limit |
| `trust proxy` and secure cookies | Workable, but every proxy hop has to be configured correctly or sessions break                                                   |
| A single clock for job leases    | Multiple instances still work (the lease is in the database) but the logic is easier to reason about with one process            |

**Recommendation:** Vercel for `apps/web`, a small always-on container for `apps/api`, managed Postgres.
That is the shape this code was written and tested for.

## 3. The cookie rule that decides your domain layout

The session cookie is `httpOnly`, `Secure` in production, and **`SameSite=Lax`**. Lax means the browser sends
it on same-site requests only. So:

| Layout                                                                         | Works? | Why                                                                                          |
| ------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------- |
| Web and API on subdomains of one domain: `app.example.com` + `api.example.com` | ✅     | Same registrable domain, so it counts as same-site                                           |
| API proxied by the web app (`UPDATEPILOT_API_PROXY`, see §5a)                  | ✅     | First-party cookies, no domain needed                                                        |
| Web on `x.vercel.app`, API on `y.onrender.com` called directly                 | ❌     | Different sites: the login succeeds and the next request is anonymous                        |
| `SameSite=None` to force cross-site                                            | ⚠️     | Needs HTTPS and still fails in browsers that block third-party cookies. Weakens CSRF defence |

### 5a. The same-origin proxy, for when you have no domain

`apps/web/src/app/api/[...path]/route.ts` forwards `/api/*` to the API and copies the response back,
including `Set-Cookie`. A browser on the web origin therefore holds a first-party cookie, and the
`SameSite=Lax` rule is satisfied without buying a domain.

| Variable                | Where                            | Value                                                             |
| ----------------------- | -------------------------------- | ----------------------------------------------------------------- |
| `UPDATEPILOT_API_PROXY` | Web host, **not** `NEXT_PUBLIC_` | The API base URL, e.g. `https://updatepilot-api.onrender.com`     |
| `NEXT_PUBLIC_API_URL`   | Web host                         | **Unset.** With no value, a production build calls its own origin |

A Route Handler rather than an external `rewrite` on purpose: forwarding `Set-Cookie` is the entire point,
and doing it explicitly makes it testable instead of dependent on a host's rewrite behaviour. It was
verified locally — logging in through the proxy returned the session cookie on the web origin, and
`/api/v1/auth/me` and `/api/v1/devices` answered 200 with the right user.

If `UPDATEPILOT_API_PROXY` is unset, the route answers `503 PROXY_NOT_CONFIGURED` rather than quietly
calling the wrong place.

`WEB_ORIGIN` must equal the web app's exact origin (scheme + host + port). CORS allows credentials for that
origin only.

## 4. Environment variables

### Web (Vercel)

| Variable              | Value                                                                   |
| --------------------- | ----------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL` | The API's public URL, or empty when you proxy `/api` on the same domain |

### API (container host)

| Variable          | Value                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `NODE_ENV`        | `production`                                                                                  |
| `DATABASE_URL`    | The managed Postgres URL, with `?sslmode=require` if the host requires it                     |
| `WEB_ORIGIN`      | `https://app.example.com` — exactly the web origin                                            |
| `SESSION_SECRET`  | At least 32 random characters, **not** the `.env.example` placeholder (production refuses it) |
| `PORT`            | Whatever the host provides                                                                    |
| `ENABLE_API_DOCS` | `false` for a public deployment, unless you want `/api/docs` exposed                          |

Generate the secret with `openssl rand -base64 48` or PowerShell
`[Convert]::ToBase64String((1..48|%{Get-Random -Max 256}))`.

### Agent (each Windows PC)

| Variable              | Value                                                        |
| --------------------- | ------------------------------------------------------------ |
| `UPDATEPILOT_API_URL` | The API's public URL. Must be `https` unless it is localhost |

## 5. Deploying the web app to Vercel

1. Import the repository, set **Root Directory** to `apps/web`.
2. Framework preset: Next.js. Build command `npm run build`, output is detected.
3. Add `NEXT_PUBLIC_API_URL` (see §4).
4. Deploy. The build runs `next typegen && tsc` through the repo's own scripts, so a type error fails the
   deployment rather than shipping.

If you use the rewrite shape instead, add to the web project a rewrite from `/api/:path*` to
`https://api.example.com/api/:path*` and set `NEXT_PUBLIC_API_URL` to an empty string, so the browser calls
its own origin and cookies stay first-party.

## 6. Deploying the API

1. Create a Postgres database and copy its URL.
2. Create a web service from this repository with **Root Directory** `apps/api`.
3. Build: `npm ci && npm run db:generate -w apps/api`. Start: `npm run start -w apps/api`
   (which is `tsx src/server.ts`).
4. Run migrations once per deploy: `npm run db:deploy -w apps/api`.
5. Set the variables from §4, then health-check `GET /api/v1/health` and `/api/v1/health/ready`.
6. Do **not** run `db:seed` against production: it inserts sample data.

The API already sets `trust proxy` in production, so the rate limiters key on the real client address.

### Why `tsx` and `prisma` are production dependencies

The first Render deployment built successfully and then died with `sh: 1: tsx: not found`. The cause:
`NODE_ENV=production` makes `npm ci` skip devDependencies, and the API's start command runs TypeScript
directly (`tsx src/server.ts`), while `npm run db:deploy` needs the Prisma CLI. Both therefore sit in
`dependencies`, not `devDependencies`. The cost is a slightly larger image; the alternative is compiling
to JavaScript at build time and shipping `node dist/server.js`, which would be the next step if image
size mattered.

The same trap applies to any host that sets `NODE_ENV=production` before installing.

## 7. Adding another PC (this is what multi-machine means)

Nothing about the web app changes. For every machine you want to manage:

1. On that PC: install Node 22, clone or copy the repository, `npm install`.
2. Sign in to the **hosted** web app, go to **Settings & agent**, and press **Create pairing code**.
3. On that PC: `npm run pair -w apps/agent -- --code XXXX-XXXX --name THIS-PC`
4. Start it and leave it running: `npm start -w apps/agent`. For a permanent install, run it as a scheduled
   task or service at logon (Week 6 packaging work).
5. That device appears in the list within about ten seconds and turns **Active** on its first poll.

Each computer needs its own pairing. One agent does not manage two machines.

### Can another person use it with their own PC?

Yes, as a normal multi-user deployment: they register their own account, pair their own PC, and see only
their own devices. Ownership is enforced in every query (`docs/inventory-api.md` §4), so one account cannot
read, scan or update another account's machine, and a scan or update for someone else's device answers 404.

What you must decide before opening registration publicly:

| Gap                            | Consequence today                                                    |
| ------------------------------ | -------------------------------------------------------------------- |
| No email verification          | Anyone can register any address                                      |
| No password reset              | A forgotten password means a new account                             |
| No cap on accounts per address | Registration rate limiting is per IP only, and in memory             |
| Agent is distributed by hand   | A stranger cannot "just install it" yet; packaging is Week 6 work    |
| Updates need local rights      | Some installers raise UAC on that PC, and someone there must approve |

## 8. Before exposing it publicly

- [ ] `SESSION_SECRET` is random and not the example value
- [ ] `WEB_ORIGIN` is the exact web origin, and the layout follows §3
- [ ] HTTPS on both hosts
- [ ] `ENABLE_API_DOCS=false`
- [ ] Migrations run on deploy, never `db:seed`
- [ ] Database backups and a data-retention decision
- [ ] A single API instance, or accept that rate limits are per instance
- [ ] The audit trail copied somewhere durable if you need it long-term

## 9. What this shape does not give you

- No queue: a scan or update is a row the agent polls for. If every agent is offline, jobs wait, and the lease
  turns stale ones `INTERRUPTED` after 10 or 30 minutes.
- No push: the browser polls. Opening the Update Center keeps it current; leaving it does not.
- No shared rate-limit store, no email, no scheduled scans (`FR-13`), no exports (`FR-11`), no packaged agent
  installer, and no OS other than Windows (`FR-14`).

Those are the remaining items in `README.md` → Status.
