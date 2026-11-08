# UpdatePilot: Inventory APIs

Status: Implemented in Week 2, Day 3
Code: `apps/api/src/routes/` (`devices.ts`, `dashboard.ts`, `applications.ts`) and `apps/api/src/inventory/`
Contracts: `packages/shared/src/api.ts` and `docs/openapi.yaml`

## 1. Endpoints

All four need a signed-in user (`requireAuth`), are read-only, and send `Cache-Control: no-store`, because the data is private.

| Method | Path                       | Returns                                                                     |
| ------ | -------------------------- | --------------------------------------------------------------------------- |
| GET    | `/api/v1/devices`          | `{ data: Device[] }`, the user's devices with a computed `connection` state |
| GET    | `/api/v1/dashboard`        | Counts, last scan, agent state and recent activity for the Overview page    |
| GET    | `/api/v1/applications`     | A page of the user's applications (search, filters, sorting, pagination)    |
| GET    | `/api/v1/applications/:id` | One application with release info and update history                        |

## 2. `GET /applications` query parameters

| Parameter        | Values                                                                           | Default       |
| ---------------- | -------------------------------------------------------------------------------- | ------------- |
| `page`           | integer, 1 or more                                                               | 1             |
| `pageSize`       | integer, 1 to 100                                                                | 25            |
| `q`              | text, up to 100 characters. Matches name, publisher or package ID, ignoring case | none          |
| `updateStatus`   | `UP_TO_DATE`, `UPDATE_AVAILABLE`, `UNKNOWN`                                      | none          |
| `matchStatus`    | `MATCHED`, `UNMATCHED`, `UNSUPPORTED`, `UNKNOWN`                                 | none          |
| `source`         | text, for example `winget`                                                       | none          |
| `deviceId`       | UUID of one of the user's devices                                                | all devices   |
| `includeRemoved` | `true` or `false`                                                                | `false`       |
| `sort`           | `displayName`, `publisher`, `installedVersion`, `updateStatus`, `lastSeenAt`     | `displayName` |
| `order`          | `asc` or `desc`                                                                  | `asc`         |

All parameters work together. Anything outside these values returns `400 VALIDATION_ERROR` with the field name in `details`. The response is `{ data, page, pageSize, total, totalPages }`. A page past the end returns an empty `data` list, not an error.

## 3. How values are worked out

| Value                  | Rule                                                                                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connection`           | Not stored. `revoked` or `pending` follow the device status. Otherwise: `connected` if the agent was seen within 30 seconds (3 poll intervals), `stale` within 10 minutes, `disconnected` after that or if never seen |
| Dashboard counts       | Across all of the user's devices, skipping applications marked removed. `updatesAvailable` counts `UPDATE_AVAILABLE`; `unmatched` and `unsupported` count the match status                                            |
| `lastScanAt`           | Finish time of the latest scan that succeeded. Failed scans are ignored                                                                                                                                               |
| Dashboard `agent`      | The most recently seen device that is not revoked. If every device is revoked, one of those. With no device: `connection: "pending"` and `deviceId: null`                                                             |
| `isSample`             | `true` if any included device is sample data, so the UI shows the "Sample data" banner                                                                                                                                |
| Recent activity        | The 10 newest audit events for the user's devices or actions, newest first. Sign-in events are left out. Text comes from a fixed sentence per event type, never from stored metadata                                  |
| Detail `release`       | The cached release for the application's available version, or `null`. Only `https` links are passed on; anything else becomes `null`                                                                                 |
| Detail `updateHistory` | The newest 20 update jobs for that application                                                                                                                                                                        |

## 4. Security measures

| Risk                            | Measure                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Reading someone else's data     | The ownership condition is part of every query. A `deviceId` that belongs to someone else simply matches nothing                      |
| Probing for IDs                 | A missing application, an invalid ID and another user's application all return the same `404`                                         |
| Choosing a column to sort by    | `sort` is a fixed list in the shared schema, so the client can never pick an arbitrary column                                         |
| SQL in the search text          | All queries are parameterized by Prisma. `%`, `_` and `\` are escaped, so they are searched as plain characters                       |
| Unsafe links from release feeds | `javascript:`, `data:` and plain `http:` links are dropped before they reach the response                                             |
| Leaking internal columns        | Responses are built field by field from the shared types. `appKey`, timestamps like `createdAt`, and similar columns are never copied |
| Caching of private data         | `Cache-Control: no-store` on every response                                                                                           |
| Huge page numbers               | A page whose offset would overflow the database returns an empty list without querying                                                |

## 5. Tests

`npm test -w apps/api` runs, among others:

- `inventory/*.test.ts`: connection thresholds, link filtering, search escaping and the activity feed (no database needed).
- `routes/inventory.routes.test.ts`: real HTTP requests against the database (skipped without `DATABASE_URL`). It covers ownership between two users, every filter and sort, combined filters with pagination, stable paging when many rows tie, invalid input (15 cases), the dashboard rules, release and history handling, and the 404 behavior. **Every successful response is also parsed with the shared contract schemas**, so the API cannot drift from `docs/openapi.yaml` unnoticed.

The tests use `@example.test` users and remove every row they create.

## 6. Known limits

- Sorting by name uses the database's text ordering. In the default Docker image this is plain byte order, so capital letters sort before lowercase ones (`VLC` before `Visual Studio`). A case-insensitive sort needs a lowercase sort column, planned together with the scan code in Week 3.
- Search uses `ILIKE '%text%'`, which cannot use an index. This is fine for thousands of applications per user. If inventories grow far larger, add a trigram index.
- The 30-second and 10-minute connection thresholds are constants in `inventory/connection.ts`. Week 3 ties them to the real poll interval.
- Totals and rows are read in two queries, so a scan finishing between them can briefly make `total` and the page disagree by a row. This is harmless for a list view.
