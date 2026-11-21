# UpdatePilot: The Windows Agent

Status: Implemented in Week 3. Update execution arrives in Week 4.
Code: `apps/agent/src/`, `apps/api/src/agent/`, `apps/api/src/routes/agent.ts`
Related: [`docs/agent-protocol.md`](agent-protocol.md) (the agreed contract), [`docs/scans.md`](scans.md) (how a scan reaches the dashboard), [`docs/job-states.md`](job-states.md)

The agent is the only part of UpdatePilot that touches the computer. The browser cannot read installed
software, and it should not be allowed to try: the agent runs as the signed-in user, accepts two
operations, and calls the API — the API never calls it.

## 1. What it does today

| Operation                           | State  |
| ----------------------------------- | ------ |
| Pair with a one-time code           | Done   |
| Poll for work and send a heartbeat  | Done   |
| Read installed software with WinGet | Done   |
| Report scan results                 | Done   |
| Run an update                       | Week 4 |
| Verify an update by rescanning      | Week 4 |

## 2. Requirements

| Requirement     | Notes                                                  |
| --------------- | ------------------------------------------------------ |
| Windows 10/11   | The agent shells out to `winget.exe`                   |
| WinGet          | Comes with App Installer. `winget --version` must work |
| Node.js 22      | Same version as the repository (`.nvmrc`)              |
| The API running | `npm run dev` from the repository root                 |

## 3. Setup

Three steps, in this order. Keep the API and the agent running in separate terminals.

```powershell
# Terminal 1: API and web app
npm run dev

# Terminal 2: pair this computer. Creates a one-time code, pairs, and prints the next step
npm run agent:setup

# Terminal 2 again: start the agent and leave it running
npm start -w apps/agent
```

Then press **Scan now** on the Overview page, or run `npm run scan` in a third terminal.

What the pairing step does:

1. Deletes any previous credential, so pairing really starts fresh.
2. Asks the API for a one-time code (`XXXX-XXXX`, valid for 10 minutes, single use).
3. Exchanges the code for this device's credential and stores it under Windows DPAPI.
4. Prints the device name and its status. `PENDING` is normal: the device becomes `ACTIVE` on the
   agent's first successful poll, which happens as soon as the agent starts.

## 4. The poll loop

```
every 10 seconds (the server decides the interval):
  GET /api/v1/agent/jobs/next     Authorization: Bearer <agent token>
    -> { job | null, pollIntervalSeconds, serverTime }
```

- The poll **is** the heartbeat. It writes `lastSeenAt`, which the dashboard turns into
  `connected` (within 30 s), `stale` (within 10 min), `disconnected` (after that).
- The server claims a `QUEUED` job with a compare-and-set, so only one agent can receive it.
- A scan is executed immediately; an update reports progress and a result (Week 4).
- Errors back off 10 s → 30 s → 60 s and stay at 60 s, except:
  - **401** — the credential is invalid: the agent stops and says so.
  - **403** — the device was revoked by its owner: the agent stops and says so.
  - **429** — the agent waits for `Retry-After`.
- If the agent dies mid-job, the server's lease (10 minutes for a scan, 30 for an update) moves the
  job to `INTERRUPTED`. Nothing stays `RUNNING` for ever.

## 5. Security model

| Property                                     | How                                                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| The agent authenticates itself, never a user | `Authorization: Bearer <token>`; the token is 256 random bits                                              |
| The server stores only a hash                | `AgentCredential.tokenHash` (SHA-256). A database dump contains no usable token                            |
| The token is protected on disk               | `%LOCALAPPDATA%\UpdatePilot\agent-credential.bin`, encrypted with Windows DPAPI for the current user       |
| The token never reaches a log                | It is passed only to the credential store; log lines carry job ids and exit codes                          |
| No shell                                     | `execFile('winget.exe', [...])` with an argument array. No string is ever concatenated into a command line |
| Only two operations exist                    | `scan` and `upgrade`, enforced by `agentJobSchema` on both sides                                           |
| The agent validates independently            | Every job is re-parsed with the same shared schema the API used; an unknown field fails                    |
| Revocation is immediate                      | Every request checks the device status; a revoked device gets `403` and stops polling                      |
| Least privilege                              | Runs as the normal user. Elevation happens only through the Windows UAC prompt, never stored               |

Full threat list: [`docs/threat-model.md`](threat-model.md).

## 6. What the agent reads with WinGet

Two read-only commands, both parsed by pure functions in `apps/agent/src/winget/`:

| Command          | Used for                                     |
| ---------------- | -------------------------------------------- |
| `winget list`    | Installed applications and versions          |
| `winget upgrade` | Which of them have a newer version available |

Only these fields are reported: display name, installed version, available version, package ID,
source, architecture. **Publisher and architecture stay `null`** because no WinGet table contains
them — the agent does not guess.

Reality checks that the parser handles, all seen in recorded output:

- Output can be **UTF-16LE** when piped, with a BOM, and can still contain ANSI colour codes.
- Columns that overflow are **not padded**, so the identifier and the version can share one run of
  spaces: `Microsoft.SQLServerManagementStudio 19.1`.
- An ARP key may contain spaces: `ARP\Machine\X64\Apache Tomcat 9.0 Tomcat9`.
- Versions may contain a bracketed build: `5.17.11 (34827)`.
- WinGet reports ARP/MSIX identifiers (`ARP\…`, `MSIX\…_8wekyb3d8bbwe`) for applications it cannot
  match. They contain `\` and `{`, can never be a package id, and cannot be upgraded with
  `winget --id`, so they arrive as **unmatched** — visible, never guessed at.

The parsing tests run from recorded fixtures (`apps/agent/src/winget/__fixtures__/`) on any operating
system, with no WinGet installed.

## 7. Limits and known gaps

- The MVP is Windows-only. There is no macOS or Linux agent (out of scope, FR-14).
- Only `winget` is supported as a source. Store (`msstore`) applications appear as unsupported.
- `winget` cannot identify every installed application, so some rows are unmatched by design.
- The agent logs to the console. Log rotation and a packaged `.exe` are Week 6 work.
- One job at a time: an update never runs while another operation is in flight.
- The agent does not store history; the server owns all state.

## 8. Troubleshooting

| Symptom                                                  | Cause                                                                   | Fix                                                   |
| -------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| `No credential found` and the agent exits                | Never paired, or the credential was cleared                             | `npm run agent:setup`, then `npm start -w apps/agent` |
| `Agent credentials are invalid. Pair this device again.` | Token no longer matches the server (for example after a database reset) | `npm run agent:setup`                                 |
| `This device was revoked. Pair it again.`                | The device was revoked in the dashboard                                 | Pair again with `npm run agent:setup`                 |
| Dashboard shows the device as `PENDING`                  | The agent has not polled yet                                            | Start it: `npm start -w apps/agent`                   |
| Dashboard shows `stale`, then `disconnected`             | The agent stopped                                                       | Check its terminal; restart it                        |
| `a scan is already queued or running`                    | One scan at a time per device                                           | Wait about 10 s, then scan again                      |
| A scan stays `QUEUED` and nothing happens                | The agent is not running, or not authenticated                          | Start it and watch for 401/403                        |
| A scan becomes `INTERRUPTED`                             | The agent died mid-scan (lease expired)                                 | Restart the agent and scan again                      |
| `submitted 0 applications`                               | WinGet's output did not parse on this machine                           | Record the output and add a fixture (see §6)          |
| `winget` not found                                       | WinGet is not installed                                                 | Install App Installer from the Microsoft Store        |

## 9. Recording a fixture

If a real machine produces output the parser cannot read, record it and make it a test:

```powershell
winget list    | Out-File -Encoding utf8 apps\agent\src\winget\__fixtures__\winget-list.txt
winget upgrade | Out-File -Encoding utf8 apps\agent\src\winget\__fixtures__\winget-upgrade.txt
npm test -w apps/agent
```

Fix the parser, not the fixture. A fixture that matches a real machine is the only thing that keeps
this code honest.
