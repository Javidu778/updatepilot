# UpdatePilot: Threat Model

Status: Draft for team review (Day 4)
Related: `docs/agent-protocol.md`, `docs/job-states.md`, `docs/openapi.yaml`

Updates are privileged, system-changing operations. This document lists what we protect, who or what could attack it, and the mitigation for each threat. Every mitigation must map to a test (see section 7).

## 1. Assets

| Asset                       | Why it matters                                                       |
| --------------------------- | -------------------------------------------------------------------- |
| The user's Windows computer | The agent can install software on it                                 |
| Agent token                 | Lets someone act as the agent for a device                           |
| Pairing codes               | Let someone register a device to an account                          |
| User sessions and passwords | Give access to all of a user's devices and data                      |
| Software inventory          | Reveals what is installed, including outdated or vulnerable software |
| Audit trail                 | Evidence of what happened; must be trustworthy                       |
| Preview tokens              | Authorize exactly one update                                         |

## 2. Components and trust boundaries

```
 Browser (web UI)  --1-->  API (Express)  --3-->  PostgreSQL
                              ^   |
                              2   +--4--> External sources (GitHub Releases, OSV)
                              |
                       Windows agent --5--> WinGet --6--> Installer / package source
```

| Boundary | Crosses from | To                | Trust                                                     |
| -------- | ------------ | ----------------- | --------------------------------------------------------- |
| 1        | Browser      | API               | Untrusted input. Authenticated by session cookie          |
| 2        | Agent        | API               | Untrusted input. Authenticated by agent token             |
| 3        | API          | Database          | Trusted, but queries must be parameterized                |
| 4        | API          | External services | Responses are untrusted data                              |
| 5        | Agent        | WinGet            | Agent runs WinGet as a child process with fixed arguments |
| 6        | WinGet       | Installer         | WinGet verifies installer hash and signature              |

Key principle: **the API is not trusted by the agent for what to run.** The agent only runs two allowlisted operations and re-validates every field itself.

## 3. Assumptions

- The MVP runs on one machine (localhost). Over a network, all traffic must use HTTPS. The agent refuses non-HTTPS API URLs unless the host is `localhost`.
- The user installing the agent is allowed to install software on that computer.
- The operating system, WinGet and its package sources are not compromised. We rely on WinGet's own hash and signature verification and never weaken it.
- Out of scope: malware already running as the user, physical access, and attacks on Windows or WinGet themselves.

## 4. Threats and mitigations

| ID   | Threat                                                                                       | Impact                                                                                            | Mitigation                                                                                                                                                                                                                                          | Test                                                                                      |
| ---- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| T-01 | **Command injection** through a package ID or version that reaches the agent                 | Arbitrary code execution on the user's PC                                                         | Strict patterns for IDs and versions (`packageIdSchema`, `targetVersionSchema`) on the API and again on the agent. The agent never builds a shell string; it launches WinGet with an argument array and no shell. Unknown fields are rejected       | Unit tests with injection strings (done); agent integration test; security test in Week 5 |
| T-02 | **Compromised or malicious server** sends the agent a harmful job                            | Harmful action on the PC                                                                          | Agent allowlist: only `scan` and `upgrade`, source fixed to `winget`. The agent checks that the package appears in WinGet's own upgrade list for the same ID and target before running. Elevation only through the Windows UAC prompt, never stored | Agent integration tests with forged jobs                                                  |
| T-03 | **Replay** of an execute request or a job                                                    | Update runs twice or runs when not wanted                                                         | Preview token is signed, expires in 5 minutes and is single-use (its `jti` is the unique idempotency key). Compare-and-set state transitions. Agent results are idempotent                                                                          | Replay test: same token twice, same result twice                                          |
| T-04 | **Cross-user access (IDOR):** user A reads or acts on user B's devices, applications or jobs | Data leak, unauthorized updates                                                                   | Every query filters by the authenticated owner. Other users' resources return `404`. Authorization is checked in one shared function, not per route by hand                                                                                         | API tests for every route with a second user                                              |
| T-05 | **Agent token theft or leak**                                                                | Attacker impersonates the agent, reads queued jobs, submits fake results                          | Token is long and random, shown once, stored only as a hash on the server and protected on the device (Windows DPAPI, current user). Revocation and rotation supported. Revoked devices get `403` on every request. Never logged                    | Revocation test; log scan for secrets                                                     |
| T-06 | **Pairing code guessing or interception**                                                    | Attacker registers their own device to the victim's account, or the victim's PC to the attacker's | Code is generated with a CSPRNG, single-use, expires quickly (10 minutes), stored hashed, and the pairing endpoint is rate limited. The same `404` response for unknown, used and expired codes                                                     | Brute-force and reuse tests                                                               |
| T-07 | **CSRF** against cookie-authenticated routes                                                 | Attacker triggers scans or updates from another site                                              | `SameSite` cookies plus an `X-CSRF-Token` header required on all state-changing routes. `Origin` header checked. Agent routes use bearer tokens, not cookies                                                                                        | CSRF tests (missing and wrong token)                                                      |
| T-08 | **CORS misconfiguration**                                                                    | Another site reads authenticated responses                                                        | Explicit allowlist of the web origin (`WEB_ORIGIN`), credentials only for that origin, no wildcard                                                                                                                                                  | CORS test with a foreign origin                                                           |
| T-09 | **XSS** from untrusted text (app names, publishers, changelog text, agent error summaries)   | Session theft, actions as the user                                                                | All values rendered as text by React (escaped). No `dangerouslySetInnerHTML` for external data. Content Security Policy. Length limits on agent-supplied strings                                                                                    | E2E test rendering a script-like app name                                                 |
| T-10 | **Weak authentication:** password guessing, stolen session                                   | Account takeover                                                                                  | Passwords hashed with bcrypt or argon2, minimum length 12. Rate limit on login. `httpOnly`, `Secure`, `SameSite` cookies with expiry. Session invalidated on logout                                                                                 | Rate-limit and logout tests                                                               |
| T-11 | **Installer tampering or supply-chain attack**                                               | Malicious software installed                                                                      | Never pass flags that bypass hash or signature checks (for example `--ignore-security-hash`). The agent builds its own fixed argument list. Only the `winget` source is allowed                                                                     | Test that the argument list never contains bypass flags                                   |
| T-12 | **Malicious URLs** in release metadata (`javascript:`, redirects)                            | Phishing, script execution                                                                        | Only `https` URLs accepted (`releaseInfoSchema`). Links open with `rel="noopener noreferrer"`. URLs shown as text with the domain visible                                                                                                           | Schema tests                                                                              |
| T-13 | **Over-collection of personal data**                                                         | Privacy violation                                                                                 | Collect only name, publisher, version, package ID, source and architecture. No file contents, documents, passwords, browsing history or file paths. Documented in the privacy page and retention settings                                           | Schema review: `scannedApplicationSchema` is strict                                       |
| T-14 | **Secrets in logs, errors or audit metadata**                                                | Credential leak                                                                                   | Structured logger with redaction of `authorization`, cookies, tokens and passwords. Audit metadata contains only safe fields. Error responses never include stack traces                                                                            | Log scan test; error-format test                                                          |
| T-15 | **Denial of service** (huge scan payloads, poll floods, expensive queries)                   | API or database unavailable                                                                       | Body size limit, `maxItems` 5000 on scans, pagination with max 100, whitelisted sort fields, rate limiting, request timeouts                                                                                                                        | Oversize payload and pagination tests                                                     |
| T-16 | **Inconsistent or false job state** (agent disconnects, premature success)                   | User believes software is updated when it is not                                                  | State machine with compare-and-set. Success only after the rescan confirms the version. Lease timeout moves silent jobs to `INTERRUPTED`                                                                                                            | Transition and outcome unit tests (done)                                                  |
| T-17 | **Privilege abuse** (agent running as administrator all the time)                            | A bug becomes a full system compromise                                                            | Agent runs as the normal user. Elevation requested only when an update needs it, through the Windows UAC prompt, with the reason shown in the confirmation dialog                                                                                   | Manual test on a clean Windows install                                                    |
| T-18 | **SQL injection**                                                                            | Data theft or modification                                                                        | Prisma parameterized queries only. No string-built raw SQL. Sort and filter fields come from whitelists                                                                                                                                             | Code review rule; injection tests on filters                                              |
| T-19 | **Vulnerable dependencies**                                                                  | Known exploits in libraries                                                                       | Lockfile committed, GitHub Dependabot and `npm audit` in CI, minimal dependencies                                                                                                                                                                   | CI check                                                                                  |
| T-20 | **Misleading security findings**                                                             | False sense of safety or false alarm                                                              | Findings stored and shown only with a verified package match, a source, a last-verified date and a limitations note. "No findings" is never presented as "safe"                                                                                     | UI copy review; empty-state test                                                          |
| T-21 | **Sample data mistaken for real data**                                                       | Wrong decisions                                                                                   | `isSample` flag and a visible banner on every page that uses it; seed refuses to run in production                                                                                                                                                  | E2E test for the banner                                                                   |

## 5. Security requirements derived from this model

1. All API inputs are validated with the shared Zod schemas. Unknown fields are rejected on agent and execute routes.
2. A single authorization helper checks device ownership for every ID in a request.
3. State-changing user routes require a session, a CSRF token and a state check.
4. The agent accepts only the two allowlisted operations and re-validates identifiers.
5. Tokens, codes and passwords are stored only as hashes and never logged.
6. Success is only recorded after a verifying rescan.
7. Every security-relevant action writes an audit event, including rejected attempts (`UNAUTHORIZED_ATTEMPT`).

## 6. Residual risks (accepted for the MVP)

| Risk                                       | Why accepted                                     | Plan                                                                     |
| ------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------ |
| Plain HTTP on localhost during development | No network exposure when bound to localhost      | Require HTTPS for any non-localhost deployment                           |
| Agent binary is not code-signed            | No signing certificate in a free-tooling project | Documented limitation; signed agent updates listed as future work        |
| Agent trusts the OS user account           | Out of scope per assumptions                     | Document that agent token protection depends on the Windows user profile |
| Package coverage is incomplete             | WinGet does not list every application           | Unmatched and unsupported states; never guess a command                  |

## 7. Verification plan

| Week      | Activity                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| 1 (Day 4) | This document reviewed by the team. Injection and state-machine unit tests (65 tests in the shared package) |
| 2         | Authorization tests for every route with two users. CSRF and CORS tests. Validation tests                   |
| 3         | Agent tests: forged jobs rejected, argument list contains no bypass flags, token handling                   |
| 4         | Replay tests for preview and execute. Outcome tests against real WinGet output                              |
| 5         | Full security test pass (T-01 to T-21), dependency audit, log and error redaction checks                    |
| 6         | Final review against this table; update the status of every row                                             |

## 8. Review checklist (Day 4)

- [ ] The team has read the table and can name the mitigation for T-01, T-02, T-03 and T-04.
- [ ] Every mitigation has an owner and a planned test.
- [ ] Open questions are written down in `docs/decisions.md`.
