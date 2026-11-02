# UpdatePilot: Agent Protocol

Status: Draft for team review (Day 4)
Related: `docs/openapi.yaml` (Agent tag), `docs/job-states.md`, `docs/threat-model.md`
Code contracts: `packages/shared/src/identifiers.ts` and `api.ts`

The Windows agent does everything the browser cannot safely do: reading installed software and running supported updates. It is deliberately small and does not trust the server for what to execute.

## 1. Principles

1. **Two operations only:** `scan` and `upgrade`. Nothing else, ever.
2. **No shell.** The agent starts WinGet as a child process with an argument array. It never concatenates strings into a command line.
3. **Validate independently.** Every job is re-validated on the agent with the same shared schemas the API uses.
4. **The agent calls the server, never the reverse.** The agent polls outbound over HTTPS. It opens no listening port.
5. **Least privilege.** Runs as the normal user. Elevation happens only through the Windows UAC prompt when an update needs it.
6. **Never report success early.** Success needs a rescan that shows the target version.

## 2. Allowlist

| Operation | Payload fields                                  | Fixed behavior                                                               |
| --------- | ----------------------------------------------- | ---------------------------------------------------------------------------- |
| `scan`    | `jobId`                                         | Lists installed packages and available upgrades, reads only inventory fields |
| `upgrade` | `jobId`, `packageId`, `targetVersion`, `source` | Upgrades one exact package from the `winget` source                          |

Field rules (enforced by `agentJobSchema`):

| Field           | Rule                                           |
| --------------- | ---------------------------------------------- |
| `kind`          | Exactly `scan` or `upgrade`                    |
| `jobId`         | UUID                                           |
| `packageId`     | `^[A-Za-z0-9][A-Za-z0-9.+_-]{1,127}$`, no `..` |
| `targetVersion` | `^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$`, no `..`  |
| `source`        | Exactly `winget`                               |
| Anything else   | Rejected. Unknown fields fail validation       |

The upgrade command is built by the agent from fixed parts. Conceptually (exact flags to be confirmed against the installed WinGet version in Week 3):

```
winget upgrade --id <packageId> --exact --source winget --version <targetVersion>
```

Never included: any flag that skips hash or signature checks, arbitrary user-supplied arguments, custom installer paths or URLs.

## 3. Pairing flow

```
User (browser)              API                       Agent
     | POST /devices/pairing-codes |                      |
     |---------------------------->|                      |
     |<-- code ABCD-1234, 10 min --|                      |
     |   (user types the code into the agent)             |
     |                             |<-- POST /devices/pair {code, deviceName, ...}
     |                             |    validate code: unused, not expired
     |                             |    create Device + credential (hash only)
     |                             |-- deviceId, agentToken (once) -->
     |                             |                      | store token protected
```

Rules:

- The code is single-use, expires in 10 minutes and is stored as a hash.
- The pairing endpoint is rate limited. Unknown, used and expired codes all return the same `404`.
- The agent token is returned **once**. The server keeps only a hash.
- The agent stores the token protected for the current Windows user (DPAPI) and never writes it to logs or the config file in plain text.
- Revocation: the user revokes the device in the dashboard. From then on every agent request returns `403`, and the agent shows "Revoked, pair again" and stops polling.
- Rotation: a new credential can be issued; the old one is revoked (`CREDENTIAL_ROTATED`).

## 4. Polling and job claim

```
loop every pollIntervalSeconds (default 10, set by the server):
    GET /agent/jobs/next        (Authorization: Bearer <token>)
        -> { job | null, pollIntervalSeconds, serverTime }
```

- The poll doubles as a heartbeat. The server updates `lastSeenAt`.
- Connection state shown in the UI: `connected` if seen within 3 poll intervals, `stale` up to 10 minutes, `disconnected` after that.
- If a `QUEUED` job exists, the server moves it to `RUNNING` with an atomic compare-and-set and returns it. Only one agent can claim a job.
- Back off after errors (for example 10s, 30s, 60s, then stay at 60s) and respect `Retry-After` on `429`.
- If the agent crashes after claiming a job, the lease timeout moves the job to `INTERRUPTED`.

## 5. Executing a scan

1. Validate the job with `agentJobSchema`.
2. Run WinGet to list installed packages and available upgrades. Parse the output into `scannedApplicationSchema` objects.
3. Submit `POST /agent/scans/{id}/results` with `startedAt`, `finishedAt` and the application list (maximum 5000).
4. On failure, submit nothing and report the error through the next progress or result call.

What is collected: display name, publisher, installed version, available version, package ID, source, architecture. Nothing else. No file paths, no document contents, no user data.

## 6. Executing an update

Agent-side validation before running anything:

| #   | Check                                                                                               | If it fails                                       |
| --- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1   | Job passes `agentJobSchema`                                                                         | Reject; report `FAILED` with "invalid job"        |
| 2   | `source` is `winget`                                                                                | Reject                                            |
| 3   | The package ID is currently installed                                                               | Reject; report `FAILED`                           |
| 4   | WinGet lists an upgrade for that exact ID, and the offered version is the confirmed `targetVersion` | Reject; report `FAILED` with "update changed"     |
| 5   | Not already running another job                                                                     | Report `FAILED`; never run two operations at once |

Then:

1. Report `RUNNING` (implicit through the claim) and run the upgrade with the fixed argument list and a timeout (default 30 minutes).
2. Capture the exit code. Map restart-style exit codes to `restartRequired = true`. The exact list is confirmed against real WinGet output in Week 3.
3. Report `VERIFYING` through `POST /agent/jobs/{id}/progress`.
4. **Rescan the installed version of that one package.**
5. Submit `POST /agent/updates/{id}/result` with `exitCode`, `restartRequired`, `installedVersionAfter`, timestamps and a short `errorSummary` (maximum 1000 characters, plain text, no secrets).
6. The server decides the final state (see `docs/job-states.md`, section 6).

Elevation: if WinGet or the installer needs administrator rights, Windows shows the UAC prompt. The agent does not store credentials and does not run permanently as administrator. If the user declines, the exit code is captured and the job ends `FAILED` with a clear reason.

## 7. Error handling

| Situation                       | Agent behavior                                                                |
| ------------------------------- | ----------------------------------------------------------------------------- |
| API unreachable                 | Retry with backoff. No job is lost; the server holds it                       |
| `401`                           | Stop and show "Agent credentials invalid"                                     |
| `403` (revoked)                 | Stop polling and show "Device revoked, pair again"                            |
| `409` on a result               | The job is already final or changed; log it and move on                       |
| `429`                           | Wait for `Retry-After`                                                        |
| WinGet not installed or too old | Report a clear error on scan; refuse updates                                  |
| Timeout                         | Kill the child process, report `FAILED` with "timed out"                      |
| Agent restarted mid-job         | The job becomes `INTERRUPTED` via the lease; the user rescans before retrying |

## 8. Agent logging

- Log: timestamps, job IDs, operation, exit codes, and validation failures.
- Never log: the agent token, pairing codes, full environment variables, or user file paths.
- Log rotation with a size limit.

## 9. Configuration

| Setting       | Source                      | Notes                                                     |
| ------------- | --------------------------- | --------------------------------------------------------- |
| API base URL  | Config file or pairing step | Must be `https` unless the host is `localhost`            |
| Agent token   | Protected store (DPAPI)     | Never in the config file                                  |
| Poll interval | Server response             | Default 10 seconds                                        |
| WinGet path   | Resolved at startup         | Uses the installed `winget`; never a path from the server |

## 10. Test plan (Week 3 and 5)

| Test                                 | Expectation                                          |
| ------------------------------------ | ---------------------------------------------------- |
| Forged job with an unknown operation | Rejected, nothing runs                               |
| Package ID with shell characters     | Rejected by validation                               |
| Extra fields in a job                | Rejected                                             |
| Argument list inspection             | Contains no bypass flags and no user-supplied extras |
| Non-zero exit code                   | Reported as `FAILED`, never success                  |
| Exit zero but version unchanged      | Reported so the server records `VERIFICATION_FAILED` |
| Revoked token                        | Polling stops                                        |
| Timeout                              | Process killed, `FAILED`                             |
| Recorded WinGet output samples       | Parsed into valid `ScannedApplication` objects       |

## 11. Open items to confirm in Week 3

- Exact WinGet flags and output format on the target Windows version.
- Which exit codes mean "restart required".
- Whether WinGet can pin the target version for every package, or only report the latest.
- Packaging format for the agent (bundled executable or installer) and auto-start behavior.
