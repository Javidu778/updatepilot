# UpdatePilot

Software update intelligence and management for Windows. A web dashboard and a local Windows agent discover installed applications, find available updates through WinGet, and run updates only after the user confirms them.

> **Status: Week 1 complete (application shell).** The project has a working API shell, a web shell with six placeholder pages, a database schema with sample data, API contracts and a threat model. Scanning, pairing and updating are **not built yet**. See [Status](#status).

## How it fits together

```
Browser (Next.js)  -->  API (Express)  -->  PostgreSQL (Prisma)
                           ^
                           |  outbound polling over HTTPS
                     Windows agent  -->  WinGet
```

The browser never runs commands on your computer. A small agent does, and it accepts only two operations (`scan` and `upgrade`). Read [`docs/agent-protocol.md`](docs/agent-protocol.md) and [`docs/threat-model.md`](docs/threat-model.md).

## Prerequisites

| Tool                   | Version | Check                             |
| ---------------------- | ------- | --------------------------------- |
| Node.js                | 22      | `node --version`                  |
| npm                    | 10+     | `npm --version`                   |
| Git                    | any     | `git --version`                   |
| Docker Desktop         | any     | `docker --version` (for Postgres) |
| Windows 10/11 + WinGet | -       | Needed from Week 3, for the agent |

## Setup

```powershell
git clone https://github.com/Javidu778/updatepilot.git
cd updatepilot

npm install

# Environment file (never commit .env)
Copy-Item .env.example .env

# Database
npm run db:up                                   # starts PostgreSQL in Docker
npm run db:generate -w apps/api                 # generates the Prisma client
npm run db:migrate -w apps/api                  # applies migrations
npm run db:seed -w apps/api                     # optional: labelled sample data

# Run the API and the web app together
npm run dev
```

| URL                                 | What                           |
| ----------------------------------- | ------------------------------ |
| http://localhost:3000               | Web app                        |
| http://localhost:4000/api/docs      | API documentation (Swagger UI) |
| http://localhost:4000/api/v1/health | API health check               |

On macOS or Linux use `cp .env.example .env` instead of `Copy-Item`.

The sidebar of the web app shows **API online** when it can reach the API.

## Scripts

Run from the repo root.

| Command                         | What it does                                                |
| ------------------------------- | ----------------------------------------------------------- |
| `npm run dev`                   | API (port 4000) and web app (port 3000) with live reload    |
| `npm run lint`                  | ESLint for the whole repo                                   |
| `npm run format`                | Format with Prettier. `format:check` only checks            |
| `npm run typecheck`             | TypeScript checks in every workspace                        |
| `npm test`                      | Unit and API tests in every workspace                       |
| `npm run build`                 | Production build of the web app                             |
| `npm run verify`                | Everything CI runs: lint, format check, types, tests, build |
| `npm run db:up` / `db:down`     | Start or stop PostgreSQL in Docker                          |
| `npm run db:studio -w apps/api` | Browse the database in Prisma Studio                        |

Run `npm run verify` before opening a pull request. It needs the Prisma client, so run `npm run db:generate -w apps/api` once first.

## Repository layout

```
apps/
  api/        Express API, Prisma schema, migrations, seed data
  web/        Next.js dashboard (App Router, Tailwind CSS)
  agent/      Windows agent (Week 3)
packages/
  shared/     Zod schemas, types and the job state machine used by all three
docs/         Scope, wireframes, design system, ERD, API contracts, threat model
scripts/      Small repo tooling scripts
```

## Documentation

| Document                                           | Contents                                  |
| -------------------------------------------------- | ----------------------------------------- |
| [`docs/scope.md`](docs/scope.md)                   | MVP scope, requirements, user journeys    |
| [`docs/team.md`](docs/team.md)                     | Roles, branching and pull request rules   |
| [`docs/decisions.md`](docs/decisions.md)           | Technical decisions and their reasons     |
| [`docs/wireframes.md`](docs/wireframes.md)         | Wireframes for all six sections           |
| [`docs/design-system.md`](docs/design-system.md)   | Colors, type, components, accessibility   |
| [`docs/erd.md`](docs/erd.md)                       | Database design                           |
| [`docs/openapi.yaml`](docs/openapi.yaml)           | API contract (also served at `/api/docs`) |
| [`docs/job-states.md`](docs/job-states.md)         | Job state machine                         |
| [`docs/agent-protocol.md`](docs/agent-protocol.md) | How the agent talks to the API            |
| [`docs/threat-model.md`](docs/threat-model.md)     | Threats and mitigations                   |

## Design tokens

`docs/design/tokens.css` is the single source of truth for colors, type and spacing. `npm run dev` and `npm run build` copy it into the web app automatically (`apps/web/src/app/tokens.css`, which is not committed). Edit only the file in `docs/design/`.

## Continuous integration

Every pull request runs `.github/workflows/ci.yml`: install, generate the Prisma client, lint, format check, type-check, test and build. The check is named **verify** and should be required on `main`. A separate **audit** job reports known dependency vulnerabilities and never blocks a merge. Dependabot opens weekly update pull requests.

## Status

| Area                                                         | State                           |
| ------------------------------------------------------------ | ------------------------------- |
| Repo, tooling, CI                                            | Done                            |
| Scope, wireframes, design system, ERD, contracts             | Done (draft, under team review) |
| Database schema, migration, sample data                      | Done                            |
| API shell: config, errors, validation, health, docs          | Done                            |
| Web shell: layout, navigation, themes, six placeholder pages | Done                            |
| Authentication, inventory API and UI                         | Week 2                          |
| Agent pairing, scanning, WinGet integration                  | Week 3                          |
| Update workflow and verification                             | Week 4                          |
| Security tests, accessibility audit, exports                 | Week 5                          |
| Packaging, documentation, demo                               | Week 6                          |

Known gaps in the shell, planned for later weeks: mobile navigation is a scrolling bar (a drawer comes in the polish pass), fonts use the system stack until Inter is added, and tablet layout has no collapsed sidebar yet.

## Troubleshooting

| Problem                                                   | Fix                                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `Cannot resolve environment variable: DATABASE_URL`       | `.env` is missing or has no `DATABASE_URL`. Copy `.env.example` and check it               |
| `Invalid environment configuration` when starting the API | The message lists every missing or invalid variable. Fix those in `.env`                   |
| `gh` or another command is "not recognized" in VS Code    | Restart VS Code fully so it picks up the new PATH                                          |
| Port 5432, 4000 or 3000 already in use                    | Stop the other program, or change the port in `.env` and `docker-compose.yml`              |
| Web shows **API unreachable**                             | Start the API (`npm run dev`), and check `WEB_ORIGIN` in `.env` is `http://localhost:3000` |
| `npm run typecheck` fails on `generated/prisma`           | Run `npm run db:generate -w apps/api`                                                      |
| ESLint peer dependency error mentioning `typescript`      | The root project uses TypeScript 6 because typescript-eslint does not support 7 yet        |
| CI fails at `npm ci` with a lockfile error                | Run `npm install` locally and commit the updated `package-lock.json`                       |

## Contributing

Work on a branch, open a pull request, and wait for `verify` to pass. Read [`docs/team.md`](docs/team.md) for branch names, commit messages and the definition of done. Never commit `.env` or any real credential. This repository is public.

## License

MIT. See [`LICENSE`](LICENSE).
