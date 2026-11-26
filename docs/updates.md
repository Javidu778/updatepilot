# UpdatePilot: Updates

Status: Implemented in Week 4. The real-machine acceptance is outstanding.
Code: `apps/api/src/routes/updates.ts`, `apps/api/src/updates/`, `apps/agent/src/winget/upgrade.ts`, `apps/agent/src/upgrade-job.ts`, `apps/web/src/components/updates/`
Contracts: `packages/shared/src/api.ts`, `docs/openapi.yaml`. Related: [`docs/job-states.md`](job-states.md), [`docs/scans.md`](scans.md), [`docs/agent.md`](agent.md)

An update is the only operation that changes a computer. Every step below exists to make sure the thing
that runs is exactly the thing the user was shown.

## 1. The flow

```
browser                        API                          agent
  GET /updates            ->  candidate list
  POST /updates/:id/preview ->  preview + previewToken (10 min, single use)
  (user reads it, presses Confirm)
  POST /updates/:id/execute  ->  202 Job (QUEUED), token spent
                                <-  GET /agent/jobs/next  claims it
                                ->  POST /agent/jobs/:id/progress  RUNNING
                                    winget upgrade --id ... --exact --version ...
                                ->  POST /agent/jobs/:id/progress  VERIFYING
                                    winget list --id ... (rescan)
                                ->  POST /agent/updates/:id/result
                                <-  200 Job (final state decided by the server)
```

## 2. Endpoints

| Method | Path                                | Who   | Returns                                                     |
| ------ | ----------------------------------- | ----- | ----------------------------------------------------------- |
| GET    | `/api/v1/updates`                   | User  | `{ data, page, pageSize, total, totalPages }` of candidates |
| POST   | `/api/v1/updates/{id}/preview`      | User  | `UpdatePreview` with a token                                |
| POST   | `/api/v1/updates/{id}/execute`      | User  | `202` with the `Job`                                        |
| POST   | `/api/v1/agent/jobs/{id}/progress`  | Agent | the `Job`, state `RUNNING` or `VERIFYING`                   |
| POST   | `/api/v1/agent/updates/{id}/result` | Agent | the `Job`, final state                                      |

`{id}` is the **application** id everywhere in the user routes, and the **update job** id in the agent routes.

## 3. What makes it a candidate

Only applications that can actually be updated appear: matched to a package id, source `winget`, not
removed, and `updateStatus = UPDATE_AVAILABLE` (which now comes from a real version comparison, not a
string difference). Everything else stays visible in the inventory but is never offered here.

An application with an update in flight is still listed, with `activeJobId` set, and its button is
disabled. One update per application at a time.

## 4. The preview token

| Property     | How                                                                         |
| ------------ | --------------------------------------------------------------------------- |
| Unforgeable  | 256 random bits, not a guessable id                                         |
| Not readable | stored only as a SHA-256 hash in `PreviewToken`                             |
| Bound        | to the user, the application, the package, the source and **both versions** |
| Short lived  | 10 minutes                                                                  |
| Single use   | `usedAt` is set in the same transaction that creates the job                |

`execute` re-checks the binding. If the user looked at "1.0.0 → 1.1.0" and a new release appeared in the
meantime, the token no longer matches and the answer is `422 UPDATE_CHANGED` — review again. A token that
is unknown, expired or already spent gives the same answer, so nothing can be probed.

There is no signing key to rotate: an opaque token stored hashed has the same properties with less to get
wrong. (The prompt in `docs/openapi.yaml` calls it "signed"; the security properties are the same and this
table is the authority.)

## 5. What the agent may run

```
winget upgrade --id <packageId> --exact --source winget --version <targetVersion>
               --disable-interactivity --accept-package-agreements --accept-source-agreements
```

The id and version are re-validated with the shared schemas on the agent, and no shell string is ever
built. No flag that skips a hash or signature check is allowed, and there is no way for the server to send
an argument of its own. Unit tests assert the exact array.

## 6. How the outcome is decided

The agent reports facts: exit code, restart flag, the version it found on rescan, and a short summary. The
**server** decides (`apps/api/src/updates/finalize.ts`):

| Facts                                   | State                 | Verification |
| --------------------------------------- | --------------------- | ------------ |
| Restart requested (3010 / 1641)         | `RESTART_REQUIRED`    | `NOT_RUN`    |
| Non-zero exit                           | `FAILED`              | `NOT_RUN`    |
| Exit 0, rescan shows the target version | `SUCCEEDED`           | `VERIFIED`   |
| Exit 0, rescan shows something else     | `VERIFICATION_FAILED` | `FAILED`     |
| Exit 0, version unreadable              | `VERIFICATION_FAILED` | `FAILED`     |

`SUCCEEDED` is never taken from an exit code alone. A verified update also corrects the inventory row;
the next scan remains the source of truth.

### Why verification waits, and which command it uses

The installer returns **before** Windows lists the new version. On the first acceptance runs, Notepad++,
GitHub CLI, GitHub Desktop and Cursor were all installed successfully and all four were recorded as
`VERIFICATION_FAILED`, because the rescan read the version too early.

Two fixes came out of that:

1. The agent polls until the reported version matches the target (about a minute), then reports the last
   version it saw. A version that is present but wrong is reported at once — waiting cannot fix it.
2. Verification reads the **unfiltered** `winget list`. With `--id … --exact`, WinGet collapses its
   columns to single spaces (`Cursor (User) Anysphere.Cursor 3.31.15 winget`), which the parser cannot
   split safely, so it silently found nothing for every package. The full table is padded and is what
   every scan already used.

A later run (Binance 1.54.19 → 2.1.0) recorded `SUCCEEDED` / `VERIFIED` in 2m40s, with the inventory row
and the audit event agreeing.

## 7. Limits

- One update per application at a time; an update never runs while another operation is in flight.
- The installer may raise a Windows UAC prompt. Nobody is at the machine, nobody clicks, and the update
  fails with the installer's exit code rather than hanging.
- A `RESTART_REQUIRED` outcome means the version is checked after the restart, by a scan.
- Update jobs have a 30-minute lease. A dead agent turns the job `INTERRUPTED`.
- Windows only, `winget` only. Store (`msstore`) applications are `UNSUPPORTED`.

## 8. Troubleshooting

| Symptom                   | Cause                                                              | Fix                                                             |
| ------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------- |
| `422 UPDATE_CHANGED`      | The preview expired, was already used, or the target version moved | Review the update again                                         |
| `409 INVALID_STATE`       | An update for that application is already running                  | Wait for the job to finish                                      |
| Job stays `QUEUED`        | The agent is not running or not authenticated                      | `npm start -w apps/agent`, check for 401/403                    |
| Job `FAILED` with 1603    | The installer refused (often needs elevation or a reboot)          | Run it once by hand, then retry                                 |
| Job `RESTART_REQUIRED`    | Installed, version not provable yet                                | Restart, then scan                                              |
| Job `VERIFICATION_FAILED` | The rescan did not show the target version                         | Read `errorSummary`; the app may have reinstalled its old build |

## 9. Tests

| Suite                                        | Covers                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `apps/api/src/updates/finalize.test.ts`      | Every outcome rule, including 3010/1641 and unreadable versions                                      |
| `apps/api/src/routes/updates.routes.test.ts` | Candidates, preview payload and token storage, spent token, changed version, another user, CSRF      |
| `apps/agent/src/winget/upgrade.test.ts`      | The exact command, absence of bypass flags, shell characters rejected, restart codes, summary limits |
| `apps/api/src/routes/agent.routes.test.ts`   | The allowlisted job payload the agent receives                                                       |

**No test runs an installer.** The real update is a manual acceptance step on a real machine.
