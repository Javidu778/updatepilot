# UpdatePilot: Scans

Status: Implemented in Week 3, Days 4 and 5
Code: `apps/api/src/routes/scans.ts`, `apps/api/src/inventory/scan.ts`, `apps/api/src/inventory/matching.ts`, `apps/agent/src/winget/`
Contracts: `packages/shared/src/api.ts`, `docs/openapi.yaml`

A scan is how a real computer's software reaches the dashboard. The browser and the agent never talk
to each other: the browser creates a job, and the agent claims it on its next poll
(`docs/agent-protocol.md` §4).

## 1. Endpoints

| Method | Path                               | Who   | Returns                                            |
| ------ | ---------------------------------- | ----- | -------------------------------------------------- |
| POST   | `/api/v1/devices/{id}/scans`       | User  | `202` with a `Job` (`kind: scan`, `state: QUEUED`) |
| GET    | `/api/v1/scans/{id}`               | User  | `200` with the same `Job`, for progress            |
| POST   | `/api/v1/agent/scans/{id}/results` | Agent | `200` with the same `Job`, now `SUCCEEDED`         |

The user routes need a session cookie, a CSRF token and ownership of the device. The agent route
needs `Authorization: Bearer <agent token>` and the job must belong to that agent's device.

## 2. Triggering a scan

1. **From the UI (normal way):** Overview → **Scan now**. The button reports "Scan requested"; it never
   claims the scan finished, because the result arrives asynchronously.
2. **From the terminal:** `powershell -ExecutionPolicy Bypass -File .\scripts\scan.ps1`
   Logs in, picks the device seen most recently, queues the scan and watches it finish.

A device may have only one scan `QUEUED` or `RUNNING` at a time; a second request gets
`409 INVALID_STATE`. A repeated `Idempotency-Key` returns the job it already created instead of a
second scan.

## 3. What happens to the data

| Step            | Effect                                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Job queued      | `ScanJob` row `QUEUED`; audit `SCAN_REQUESTED`                                                                                            |
| Agent claims it | `QUEUED → RUNNING` with `startedAt`, atomically (one agent only)                                                                          |
| Results stored  | One transaction: job `RUNNING → SUCCEEDED` with `appCount`, applications upserted, snapshots written, missing applications marked removed |
| Audit           | `SCAN_COMPLETED` with `appCount` only, never the inventory itself                                                                         |

If the agent dies mid-scan, the lease (`apps/api/src/agent/claim.ts`) moves the job to `INTERRUPTED`
after 10 minutes, so nothing stays `RUNNING` for ever.

## 4. `appKey`: why rescans do not duplicate rows

`apps/api/src/inventory/matching.ts` decides the identity of an installed application:

| Case            | Key                          |
| --------------- | ---------------------------- |
| Matched package | `pkg:<packageId lowercased>` |
| No package ID   | `app:<name>                  | <publisher> | <architecture>`, normalised to lowercase slugs |

`Application` is unique on `(deviceId, appKey)`, so a rescan updates the existing row and refreshes
`lastSeenAt`. Anything not reported by the new scan keeps an older `lastSeenAt` and is marked
`removedAt` — including after its row is updated with `removedAt: null` if it comes back.

**Changing this rule orphans every existing row.** Do it only with a migration that rewrites keys.

## 5. Statuses

| Status                            | Rule today                                                        |
| --------------------------------- | ----------------------------------------------------------------- |
| `matchStatus = UNMATCHED`         | WinGet reported no package ID for the application                 |
| `matchStatus = UNSUPPORTED`       | Package ID exists but the source is not `winget`                  |
| `matchStatus = MATCHED`           | Package ID and source `winget`                                    |
| `updateStatus = UPDATE_AVAILABLE` | Matched, and the available version differs from the installed one |
| `updateStatus = UP_TO_DATE`       | Matched, no newer version reported                                |
| `updateStatus = UNKNOWN`          | Not matched, so nothing can be claimed about updates              |

Version comparison is equality only at this stage; real ordering arrives with release metadata in
Week 4. Unmatched and unsupported applications are always visible, never given a guessed update
command.

## 6. Limits

- At most 5000 applications per scan (`shared` schema and `MAX_SCAN_APPLICATIONS`).
- Results are stored in one transaction with a 60-second budget; a very large inventory may need
  batching, which is deferred until a real machine reports one.
- `publisher` and `architecture` are `null` because WinGet's tables do not report them.
- A scan job's results are accepted only while it is `RUNNING`; a second submission gets `409`.
- Starting a scan requires an **ACTIVE** device that has polled at least once. A device that has never
  contacted the API will queue jobs that nobody claims.

## 7. Troubleshooting

| Symptom                             | Cause                                                      | Fix                                                                             |
| ----------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `409 INVALID_STATE`                 | A scan is already queued or running                        | Wait ~10 s, then run again                                                      |
| Job stays `QUEUED`, nothing happens | The agent is not running or not authenticated              | Start `npm start -w apps/agent`; check for 401/403 in its window                |
| Agent logs `401`                    | Its stored credential is stale (for example after a reset) | Delete `%LOCALAPPDATA%\UpdatePilot\agent-credential.bin` and pair again         |
| Job becomes `INTERRUPTED`           | The agent stopped mid-scan                                 | Restart the agent and scan again                                                |
| Inventory still shows "Sample data" | The seeded sample device still exists                      | Delete the `SAMPLE DEVICE` row; the banner is shown if **any** device is sample |
